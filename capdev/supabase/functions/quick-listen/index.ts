/**
 * quick-listen - Quick Listen generation entry point (0075 Phase 2).
 *
 * WHAT THIS DOES: authenticates the caller, decides whether a Quick Listen may
 * be generated for a call, and either hands back a digest that already answers
 * the request or queues exactly one new one.
 *
 * WHAT THIS DOES NOT DO, by instruction: it calls no LLM, calls no
 * text-to-speech provider, holds no provider key, writes no script, uploads no
 * audio, and never moves a digest to 'ready'. A row leaves this function in
 * 'queued' and nothing else. Phase 3 picks it up from there.
 *
 *
 * THE TRUST BOUNDARY
 *
 * The request body carries ONE field: call_id. Not org_id, not transcript_id,
 * not rubric_version_id, not prompt_version, not a speaker map, not a status.
 * Everything else is derived here from the database. An unknown key in the body
 * is a hard 400 rather than something silently ignored, because "the client
 * cannot supply that" is only true if supplying it is an error.
 *
 * Two clients are used, and which one does what is the whole security design:
 *
 *   userClient    - the anon key plus the caller's own Authorization header.
 *                   Every RLS policy applies. All READS go through it, so a
 *                   bug in this function cannot read another organisation's
 *                   call, transcript or digest: the database refuses first.
 *
 *   serviceClient - service_role. RLS does not apply. Used for exactly two
 *                   statements: expiring a dead in-flight digest and inserting
 *                   a new one. call_digest has no UPDATE or INSERT policy, by
 *                   design (0075). It is constructed only after the caller has
 *                   been authenticated and authorised, and its key never leaves
 *                   the function.
 *
 * The 0076 composite foreign keys remain the last line: even if every check
 * above were wrong, the database will not accept a digest whose org, call and
 * transcript do not belong together.
 *
 *
 * LOGGING
 *
 * Identifiers and outcomes only. No transcript text, no speaker names, no
 * email addresses. A log line is one JSON object so it can be grepped.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { computeSourceFingerprint, speakerEntriesFrom } from "./fingerprint.ts";
import {
  STALE_QUEUED_MS,
  STALE_RUNNING_MS,
  staleMillis,
  stalenessColumn,
} from "./staleness.ts";
import { runQuickListenWorker } from "./worker.ts";

/**
 * Supabase's background-task primitive. Declared rather than imported: it is
 * provided by the Edge Runtime, and is absent when this module is loaded by
 * anything else, which is why every use is guarded.
 */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Written explicitly into every row. call_digest.prompt_version has NO database
 * default, deliberately (0075): a default would let a generation path insert
 * without stating which prompt contract it used, and the row would still look
 * well-formed. When the prompt changes, this constant changes, and every digest
 * built under the old one stops being reusable.
 */
const PROMPT_VERSION = "0075-p1";

/**
 * Must equal MIN_DURATION_MS in web/src/components/QuickListenPreview.tsx. The
 * UI hides the control below this; the server refuses below this. The UI gate
 * is a courtesy, this one is the rule.
 */
const MIN_DURATION_MS = 30 * 60 * 1000;

/**
 * Generation is not reading. Anyone with call.read may eventually PLAY a
 * finished Quick Listen; only these two may cause one to be made, because
 * making one spends money and provider quota.
 */
const GENERATION_PERMISSIONS = ["raw_qa.submit", "calibration.perform"];

const IN_FLIGHT = ["queued", "running"];

// Staleness thresholds and the decision itself live in staleness.ts, where
// they can be run and asserted outside the Edge Runtime.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ fn: "quick-listen", ...fields }));
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                     */
/* -------------------------------------------------------------------------- */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json(405, {
      status: "error",
      reason: "method_not_allowed",
      message: "Use POST.",
    });
  }

  try {
    return await handle(req);
  } catch (err) {
    // Never let an exception message reach the browser: it can carry table
    // names, row contents or connection details. The detail goes to the log,
    // the caller gets a flat statement.
    log({ outcome: "unhandled_error", error: String(err) });
    return json(500, {
      status: "error",
      reason: "internal",
      message: "Quick Listen could not be requested. Please try again.",
    });
  }
});

async function handle(req: Request): Promise<Response> {
  /* ---- 1. The body: exactly one field, and it must be a uuid ------------- */

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, {
      status: "error",
      reason: "bad_request",
      message: "Expected a JSON body.",
    });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return json(400, {
      status: "error",
      reason: "bad_request",
      message: "Expected a JSON object.",
    });
  }

  const keys = Object.keys(body as Record<string, unknown>);
  const unexpected = keys.filter((k) => k !== "call_id");
  if (unexpected.length > 0) {
    // Refusing rather than ignoring. org_id, transcript_id, prompt_version and
    // status are all derived here; a client that sends one is either confused
    // or probing, and both deserve an answer that says so.
    return json(400, {
      status: "error",
      reason: "bad_request",
      message:
        `This function takes call_id and nothing else. Unexpected: ${unexpected.join(", ")}.`,
    });
  }

  const callId = (body as Record<string, unknown>)["call_id"];
  if (typeof callId !== "string" || !UUID_RE.test(callId)) {
    return json(400, {
      status: "error",
      reason: "bad_request",
      message: "call_id must be a uuid.",
    });
  }

  /* ---- 2. Who is asking -------------------------------------------------- */

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, {
      status: "error",
      reason: "unauthenticated",
      message: "Sign in to request a Quick Listen.",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    log({ outcome: "misconfigured" });
    return json(500, {
      status: "error",
      reason: "internal",
      message: "Quick Listen is not configured on this deployment.",
    });
  }

  const userClient: SupabaseClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // getUser() verifies the token against the auth server. This is NOT
  // redundant with the platform's verify_jwt: the project's own anon key is
  // itself a structurally valid JWT, so a request carrying only the anon key
  // passes platform verification and arrives here with no user at all.
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const authUser = userData?.user;
  if (userError || !authUser) {
    return json(401, {
      status: "error",
      reason: "unauthenticated",
      message: "Sign in to request a Quick Listen.",
    });
  }

  // The domain identity, resolved by the database from the verified auth uid -
  // never from anything the caller sent. Same helper authorize_call_purge uses.
  const { data: personId, error: personError } = await userClient.rpc(
    "current_person_id",
  );
  if (personError || !personId) {
    return json(403, {
      status: "error",
      reason: "no_person",
      message: "This account is not set up to use CapDev.",
    });
  }

  /* ---- 3. May they cause a generation? ----------------------------------- */

  const { data: permRows, error: permError } = await userClient
    .from("v_my_permissions")
    .select("permission_code");
  if (permError) {
    log({ outcome: "permission_read_failed", person_id: personId });
    return json(500, {
      status: "error",
      reason: "internal",
      message: "Quick Listen could not be requested. Please try again.",
    });
  }

  const held = new Set((permRows ?? []).map((r) => r.permission_code as string));
  const mayGenerate = GENERATION_PERMISSIONS.some((p) => held.has(p));
  if (!mayGenerate) {
    log({ outcome: "not_permitted", person_id: personId, call_id: callId });
    return json(403, {
      status: "error",
      reason: "not_permitted",
      message: "You are not authorised to generate a Quick Listen.",
    });
  }

  /* ---- 4. The call ------------------------------------------------------- */

  // One read that settles four questions at once, and settles them the way the
  // rest of the app does rather than by hand:
  //
  //   exists            - a row comes back or does not
  //   same organisation - v_call_list is security_invoker, and call_read is
  //                       (org_id = current_org_id() and has_permission(...))
  //   caller may read   - the same policy
  //   not archived      - the view's own WHERE c.archived_at is null
  //
  // It is also the exact row CallDetail renders, so duration_ms here is the
  // duration the reviewer is looking at, and transcript_id here is the
  // authoritative transcript by the established reviewed > manual > machine
  // ordering, which lives in the view's lateral join rather than being
  // reimplemented in TypeScript.
  const { data: call, error: callError } = await userClient
    .from("v_call_list")
    .select("id, org_id, duration_ms, transcript_id")
    .eq("id", callId)
    .maybeSingle();

  if (callError) {
    log({ outcome: "call_read_failed", person_id: personId, call_id: callId });
    return json(500, {
      status: "error",
      reason: "internal",
      message: "Quick Listen could not be requested. Please try again.",
    });
  }

  if (!call) {
    // Deliberately the same answer for "no such call", "another organisation's
    // call" and "archived": a caller must not be able to probe for the
    // existence of calls they cannot see. Same reasoning as
    // authorize_call_purge's single message.
    log({ outcome: "call_not_found", person_id: personId, call_id: callId });
    return json(404, {
      status: "error",
      reason: "call_not_found",
      message: "That call does not exist.",
    });
  }

  /* ---- 5. The 30-minute gate -------------------------------------------- */

  const durationMs = call.duration_ms as number | null;
  if (durationMs === null || durationMs < MIN_DURATION_MS) {
    // A domain answer, not a failure. Nothing is inserted.
    log({
      outcome: "not_eligible",
      person_id: personId,
      call_id: callId,
      duration_ms: durationMs,
    });
    return json(200, {
      status: "not_eligible",
      reason: "duration_under_30_minutes",
    });
  }

  /* ---- 6. The authoritative transcript ----------------------------------- */

  const transcriptId = call.transcript_id as string | null;
  if (!transcriptId) {
    log({ outcome: "not_ready", reason: "no_transcript", person_id: personId, call_id: callId });
    return json(200, {
      status: "not_ready",
      reason: "no_authoritative_transcript",
    });
  }

  const { data: transcript, error: transcriptError } = await userClient
    .from("transcript")
    .select(
      "id, call_id, org_id, version_no, kind, status, archived_at, reviewed_at, updated_at, segment_count, speakers",
    )
    .eq("id", transcriptId)
    .maybeSingle();

  if (transcriptError) {
    log({ outcome: "transcript_read_failed", person_id: personId, call_id: callId });
    return json(500, {
      status: "error",
      reason: "internal",
      message: "Quick Listen could not be requested. Please try again.",
    });
  }

  if (!transcript) {
    return json(200, {
      status: "not_ready",
      reason: "no_authoritative_transcript",
    });
  }

  // Belt and braces. The view picked it FOR this call, so a mismatch would mean
  // the view is wrong - but a digest built on another call's transcript is
  // exactly the corruption 0076 exists to prevent, and finding out here beats
  // finding out from a foreign key error.
  if (
    transcript.call_id !== call.id ||
    transcript.org_id !== call.org_id ||
    transcript.archived_at !== null ||
    transcript.status !== "available"
  ) {
    log({
      outcome: "transcript_mismatch",
      person_id: personId,
      call_id: callId,
      transcript_id: transcriptId,
    });
    return json(500, {
      status: "error",
      reason: "internal",
      message: "Quick Listen could not be requested. Please try again.",
    });
  }

  const segmentCount = (transcript.segment_count as number | null) ?? 0;
  if (segmentCount < 1) {
    // Not in the Phase 2 brief, and stated here so it can be removed if it is
    // not wanted: queuing a job whose only possible outcome is an empty script
    // costs a provider call to produce nothing.
    log({ outcome: "not_ready", reason: "no_segments", person_id: personId, call_id: callId });
    return json(200, {
      status: "not_ready",
      reason: "transcript_has_no_segments",
    });
  }

  /* ---- 7. The source fingerprint ----------------------------------------- */

  let fingerprint: string;
  try {
    fingerprint = await computeSourceFingerprint({
      transcriptId: transcript.id as string,
      versionNo: (transcript.version_no as number | null) ?? 0,
      kind: (transcript.kind as string | null) ?? "",
      reviewedAt: (transcript.reviewed_at as string | null) ?? null,
      updatedAt: (transcript.updated_at as string | null) ?? null,
      segmentCount,
      speakers: speakerEntriesFrom(transcript.speakers),
    });
  } catch (err) {
    // The fingerprint refuses to guess at input it does not recognise. A digest
    // with a fingerprint nobody can reproduce would never be reusable and would
    // never be reportably stale, so failing here is better than storing one.
    log({ outcome: "fingerprint_failed", call_id: callId, error: String(err) });
    return json(500, {
      status: "error",
      reason: "internal",
      message: "Quick Listen could not be requested. Please try again.",
    });
  }

  /* ---- 8. The active rubric version -------------------------------------- */

  // Mirrors getActiveRubric() in web/src/lib/evaluation.ts exactly, including
  // its lack of an ordering: the digest must record the same rubric version the
  // evaluations on this call are being scored against, so the two resolutions
  // have to agree. Nullable by design - no active rubric is not a reason to
  // refuse a Quick Listen.
  const { data: rubric } = await userClient
    .from("rubric_version")
    .select("id")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  const rubricVersionId = (rubric?.id as string | undefined) ?? null;

  /* ---- 9. Is there already an answer to this request? -------------------- */

  // service_role from here on, and only from here on: the caller has been
  // authenticated, authorised, and shown to be able to read this call. It is
  // used for exactly two statements - expiring a dead in-flight row and
  // inserting a new one - because call_digest has no UPDATE or INSERT policy.
  // Every READ below still goes through userClient, under RLS.
  const serviceClient: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const existing = await readCandidates(userClient, callId);
  if (existing === null) {
    return json(500, {
      status: "error",
      reason: "internal",
      message: "Quick Listen could not be requested. Please try again.",
    });
  }

  const inFlight = existing.find((d) => IN_FLIGHT.includes(d.status));
  if (inFlight) {
    const overdueBy = staleMillis(inFlight, Date.now());

    if (overdueBy === null) {
      // Rule 1. Someone is already generating this call. Two people pressing
      // the button must not become two provider bills.
      log({ outcome: "reused_in_flight", person_id: personId, call_id: callId, digest_id: inFlight.id });
      return json(200, {
        status: inFlight.status,
        digest_id: inFlight.id,
        reused: true,
      });
    }

    // Dead, not working. Release the slot and carry on to queue a fresh one.
    const won = await expireStaleInFlight(serviceClient, inFlight);
    log({
      outcome: "expired_stale_in_flight",
      person_id: personId,
      call_id: callId,
      digest_id: inFlight.id,
      prior_status: inFlight.status,
      overdue_ms: overdueBy,
      won_race: won,
    });
    // Whether this request won the expiry or a concurrent one did is not worth
    // branching on: either way the slot is now free, and the unique index is
    // the authority on which caller gets to fill it.
  }

  const reusableReady = existing.find(
    (d) =>
      d.status === "ready" &&
      d.source_fingerprint === fingerprint &&
      d.prompt_version === PROMPT_VERSION,
  );
  if (reusableReady) {
    // Rule 2. The cache. Same source state, same prompt contract - the digest
    // that exists is the digest this request would produce.
    //
    // Rules 3 and 4 need no branch of their own, and that is the point: a READY
    // digest whose fingerprint differs (stale source) or whose prompt_version
    // differs (different contract) simply fails this test and falls through to
    // a new queued row. Regeneration stays something a person asked for - a
    // changed transcript never triggers one on its own.
    log({ outcome: "reused_ready", person_id: personId, call_id: callId, digest_id: reusableReady.id });
    return json(200, {
      status: "ready",
      digest_id: reusableReady.id,
      reused: true,
    });
  }

  /* ---- 10. Queue exactly one -------------------------------------------- */

  const row = {
    org_id: call.org_id,          // from the call, never from the request
    call_id: call.id,
    transcript_id: transcript.id, // the authoritative one, verified above
    source_fingerprint: fingerprint,
    rubric_version_id: rubricVersionId,
    prompt_version: PROMPT_VERSION,
    status: "queued",
    attempt: 0,                   // nothing has been attempted yet
    created_by: personId,
    // requested_at / created_at / updated_at: database defaults. No clock from
    // this process enters the row.
  };

  const { data: inserted, error: insertError } = await serviceClient
    .from("call_digest")
    .insert(row)
    .select("id, status")
    .single();

  if (!insertError && inserted) {
    // Hand the work to the background and answer immediately. The isolate is
    // only retired once the response has returned AND every waitUntil promise
    // has settled, so generation continues after the browser has the reply and
    // the reviewer can close the tab.
    //
    // The promise is deliberately never awaited, and swallows its own failures:
    // the worker records its own terminal state in the row, and an unhandled
    // rejection here would take down the isolate for no benefit.
    const background = runQuickListenWorker(serviceClient, inserted.id as string)
      .catch((err) => {
        log({ outcome: "worker_unhandled", digest_id: inserted.id,
              error_name: (err as { name?: string })?.name ?? "Error" });
      });

    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(background);
    } else {
      // Not the Edge Runtime (a local harness, a test). Without waitUntil the
      // only way the work happens at all is to wait for it, which is slower but
      // correct; saying nothing and dropping it would be neither.
      log({ outcome: "no_waituntil_awaiting_inline", digest_id: inserted.id });
      await background;
    }

    log({ outcome: "queued", person_id: personId, call_id: callId, digest_id: inserted.id });
    return json(200, {
      status: "queued",
      digest_id: inserted.id,
      reused: false,
    });
  }

  /* ---- 11. Losing the race is a normal outcome, not a 500 ---------------- */

  // call_digest_one_in_flight_per_call is a unique partial index on call_id
  // where status in ('queued','running') and archived_at is null. If a
  // concurrent request inserted first, this insert raises 23505 - which means
  // the work this caller wanted is already queued. Hand them the winner.
  if (insertError?.code === "23505") {
    const after = await readCandidates(userClient, callId);
    const winner = after?.find((d) => IN_FLIGHT.includes(d.status));
    if (winner) {
      log({ outcome: "race_resolved", person_id: personId, call_id: callId, digest_id: winner.id });
      return json(200, {
        status: winner.status,
        digest_id: winner.id,
        reused: true,
      });
    }
    // The winner finished and was archived in the microseconds between. Rare
    // enough to be worth saying out loud rather than papering over with a retry
    // loop; the caller presses the button again.
    log({ outcome: "race_unresolved", person_id: personId, call_id: callId });
    return json(409, {
      status: "error",
      reason: "generation_race_unresolved",
      message: "Another request is already preparing this call. Try again.",
    });
  }

  log({
    outcome: "insert_failed",
    person_id: personId,
    call_id: callId,
    code: insertError?.code ?? null,
  });
  return json(500, {
    status: "error",
    reason: "internal",
    message: "Quick Listen could not be requested. Please try again.",
  });
}

/* -------------------------------------------------------------------------- */

interface DigestCandidate {
  id: string;
  status: string;
  source_fingerprint: string;
  prompt_version: string;
  requested_at: string;
  started_at: string | null;
}

/**
 * Marks one dead in-flight digest 'failed' so it stops holding the slot.
 *
 * Race safety comes from the WHERE clause, not from a lock we take ourselves.
 * `.eq("status", d.status)` is a compare-and-swap: under READ COMMITTED, two
 * concurrent callers both try the UPDATE, Postgres serialises them on the row,
 * and the second one re-evaluates its condition against the row the first
 * already changed. status is no longer what it was, so the second matches zero
 * rows. Exactly one caller performs the transition.
 *
 * The timeout comparison is repeated in the WHERE as well, so a row that
 * stopped being stale between the read and the write (a worker that reported in
 * late) is not expired out from under itself.
 *
 * Both callers then go on to insert, and call_digest_one_in_flight_per_call
 * decides which of them gets the new row. The loser sees 23505 and is handed
 * the winner, exactly as in the ordinary race.
 *
 * The Edge Function's clock is used for the cutoff and for finished_at. Both
 * are NTP-synced to within seconds and the thresholds are quarter-hours, so the
 * skew cannot change an outcome; nothing correctness-bearing reads either value.
 */
async function expireStaleInFlight(
  service: SupabaseClient,
  d: DigestCandidate,
): Promise<boolean> {
  const limit = d.status === "running" ? STALE_RUNNING_MS : STALE_QUEUED_MS;
  const column = stalenessColumn(d);
  const cutoff = new Date(Date.now() - limit).toISOString();
  const minutes = Math.round(limit / 60000);

  const { data, error } = await service
    .from("call_digest")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message:
        `timeout_${d.status}_${Math.round(limit / 1000)}s: no generation worker ` +
        `finished this digest within ${minutes} minutes; the in-flight slot was ` +
        `released so the call can be requested again.`,
    })
    .eq("id", d.id)
    .eq("status", d.status)
    .is("archived_at", null)
    .lt(column, cutoff)
    .select("id");

  if (error) {
    log({ outcome: "expire_failed", digest_id: d.id, code: error.code });
    return false;
  }
  return (data ?? []).length === 1;
}

/**
 * Every live digest for the call, newest request first.
 *
 * Read through the CALLER's client, not service_role. The reuse decision only
 * ever needs digests this person is allowed to see, and reading them under RLS
 * means a mistake in this function cannot hand back another organisation's
 * digest id.
 *
 * Returns null on a read failure, which is distinct from an empty list.
 */
async function readCandidates(
  client: SupabaseClient,
  callId: string,
): Promise<DigestCandidate[] | null> {
  const { data, error } = await client
    .from("call_digest")
    .select("id, status, source_fingerprint, prompt_version, requested_at, started_at")
    .eq("call_id", callId)
    .is("archived_at", null)
    .order("requested_at", { ascending: false });

  if (error) {
    log({ outcome: "digest_read_failed", call_id: callId, code: error.code });
    return null;
  }
  return (data ?? []) as DigestCandidate[];
}
