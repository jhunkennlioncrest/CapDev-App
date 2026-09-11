/**
 * The Quick Listen generation worker (0075 Phase 3A).
 *
 * PHASE 3A STOPS BEFORE THE PROVIDER. This worker claims a queued digest, proves
 * the source is still the source it was queued against, assembles the structure
 * a condensation provider will one day receive - and then stops and marks the
 * row failed, because there is no provider. Nothing is sent anywhere. No
 * transcript text leaves CapDev. That is the whole point of the phase: prove the
 * mechanics while the stakes are still zero.
 *
 * Nothing it writes is user-visible as a Quick Listen. There is no simulated
 * script, no placeholder audio, and no 'ready' state reachable from this file.
 *
 *
 * WHY IT RUNS IN THE REQUEST'S OWN ISOLATE
 *
 * quick-listen hands this function to EdgeRuntime.waitUntil() after inserting
 * the queued row, and answers the browser immediately. The isolate stays alive
 * until the promise settles - Supabase only retires a worker early once the
 * response has returned AND every waitUntil promise has resolved - so the work
 * genuinely continues after the user has walked away.
 *
 * The alternative was a queue drained by a second function. It was rejected for
 * this phase on evidence, not taste: pg_net, pg_cron, pgmq and http are all
 * AVAILABLE BUT NOT INSTALLED on this project, so that design starts by adding a
 * database extension, and then adds a second externally callable endpoint with
 * its own authentication surface. Two new moving parts to prove a state machine.
 *
 * The cost of this choice, stated plainly: THERE IS NO RETRY. If the isolate
 * dies mid-work the row stays 'running' until the staleness timeout reclaims the
 * slot, and the job is not resumed - a person asks again. That is acceptable
 * while regeneration is user-triggered and condensation fits inside one worker.
 * It is the reason to revisit if condensation ever approaches the ceiling.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { computeSourceFingerprint, speakerEntriesFrom } from "./fingerprint.ts";
import type { SourceSegment } from "./scriptContract.ts";

/** Must match PROMPT_VERSION in index.ts. A digest queued under a different
 *  prompt contract is not this worker's to process. */
const WORKER_PROMPT_VERSION = "0075-p1";

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ fn: "quick-listen", stage: "worker", ...fields }));
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export async function runQuickListenWorker(
  service: SupabaseClient,
  digestId: string,
): Promise<void> {
  let claimed = false;
  try {
    const claim = await claimDigest(service, digestId);
    if (!claim) {
      // Someone else claimed it, or it is no longer queued. Not an error: the
      // compare-and-swap did exactly its job.
      log({ outcome: "claim_lost", digest_id: digestId });
      return;
    }
    claimed = true;
    log({ outcome: "claimed", digest_id: digestId, attempt: claim.attempt });

    const source = await resolveSource(service, claim);
    if ("reason" in source) {
      await markFailed(service, digestId, source.reason, source.detail);
      log({ outcome: "source_refused", digest_id: digestId, reason: source.reason });
      return;
    }

    // Built, held in memory, and sent nowhere. Only its SHAPE is logged.
    const criteria = await loadRubricCriteria(service, claim.rubric_version_id);
    const input = buildProviderInput(claim, source, criteria);
    log({
      outcome: "provider_input_built",
      digest_id: digestId,
      segments: input.segments.length,
      speakers: input.speakers.length,
      criteria: input.rubricCriteria.length,
      duration_ms: input.callDurationMs,
    });

    // ---- Phase 3A ends here, deliberately. -------------------------------
    // There is no condensation provider and no script. Marking this failed
    // rather than inventing a terminal success keeps the row truthful, releases
    // the one-in-flight slot, and leaves nothing that could be mistaken for a
    // real Quick Listen.
    await markFailed(
      service,
      digestId,
      "phase3a_no_provider",
      "worker reached the condensation step; no provider is configured in this phase",
    );
    log({ outcome: "stopped_before_provider", digest_id: digestId });
  } catch (err) {
    // Any exception at all must leave the row recoverable and honest. The
    // message is a fixed string plus an error NAME - never err.message, which
    // can carry row contents, URLs or connection details.
    const name = (err as { name?: string })?.name ?? "Error";
    log({ outcome: "worker_exception", digest_id: digestId, error_name: name });
    if (claimed) {
      await markFailed(service, digestId, "worker_exception",
        `the worker failed with ${String(name).slice(0, 60)}`).catch(() => {});
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 1. Claim                                                                    */
/* -------------------------------------------------------------------------- */

export interface ClaimedDigest {
  id: string;
  org_id: string;
  call_id: string;
  transcript_id: string;
  source_fingerprint: string;
  prompt_version: string;
  rubric_version_id: string | null;
  attempt: number;
}

/**
 * Moves one queued digest to running, or returns null if it was not ours.
 *
 * Compare-and-swap on BOTH status and attempt. Two workers read the same
 * queued row with attempt 0; both issue the update; Postgres serialises them on
 * the row and, under READ COMMITTED, the second re-evaluates its WHERE against
 * the row the first already changed. status is 'running' and attempt is 1, so
 * the second matches nothing and returns zero rows. Exactly one worker proceeds.
 *
 * attempt is incremented HERE and only here - on a successful claim. Phase 2
 * inserts attempt = 0, so the first real attempt at generation is attempt = 1.
 * Viewing or reusing a queued row never touches it.
 */
async function claimDigest(
  service: SupabaseClient,
  digestId: string,
): Promise<ClaimedDigest | null> {
  const { data: current, error: readError } = await service
    .from("call_digest")
    .select("id, org_id, call_id, transcript_id, source_fingerprint, prompt_version, rubric_version_id, status, attempt, archived_at")
    .eq("id", digestId)
    .maybeSingle();

  if (readError || !current) return null;
  if (current.status !== "queued" || current.archived_at !== null) return null;

  const priorAttempt = (current.attempt as number | null) ?? 0;

  const { data, error } = await service
    .from("call_digest")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      attempt: priorAttempt + 1,
    })
    .eq("id", digestId)
    .eq("status", "queued")        // ← the compare-and-swap
    .eq("attempt", priorAttempt)   // ← and again, on the counter
    .is("archived_at", null)
    .select("id, org_id, call_id, transcript_id, source_fingerprint, prompt_version, rubric_version_id, attempt");

  if (error) {
    log({ outcome: "claim_failed", digest_id: digestId, code: error.code });
    return null;
  }
  const rows = (data ?? []) as ClaimedDigest[];
  if (rows.length !== 1) return null;
  return rows[0]!;
}

/* -------------------------------------------------------------------------- */
/* 2. Revalidate the source                                                    */
/* -------------------------------------------------------------------------- */

export interface ResolvedSource {
  segments: SourceSegment[];
  speakers: { label: string; name: string | null; role: string | null }[];
  callDurationMs: number | null;
}

interface SourceRefusal {
  reason: string;
  detail: string;
}

/**
 * Proves the digest is still about the source it was queued against.
 *
 * Between the request and this moment a transcript can be corrected, superseded
 * or re-transcribed, and the call can be archived. Condensing whatever is there
 * now would produce a Quick Listen whose fingerprint is a lie - it would claim
 * provenance over a source state that never produced it.
 *
 * A refusal here is terminal. It does NOT queue a replacement: regeneration
 * stays something a person asks for, so that a transcript edit cannot silently
 * spend money.
 */
async function resolveSource(
  service: SupabaseClient,
  digest: ClaimedDigest,
): Promise<ResolvedSource | SourceRefusal> {
  if (digest.prompt_version !== WORKER_PROMPT_VERSION) {
    return {
      reason: "prompt_version_mismatch",
      detail: `queued under ${digest.prompt_version}; this worker builds ${WORKER_PROMPT_VERSION}`,
    };
  }

  // v_call_list excludes archived calls and computes the authoritative
  // transcript by the established reviewed > manual > machine ordering. Asking
  // it is how the worker and the request agree on what "the transcript" means.
  const { data: call } = await service
    .from("v_call_list")
    .select("id, org_id, duration_ms, transcript_id")
    .eq("id", digest.call_id)
    .maybeSingle();

  if (!call) {
    return { reason: "call_unavailable", detail: "the call no longer exists or has been archived" };
  }
  if (call.org_id !== digest.org_id) {
    return { reason: "org_mismatch", detail: "the call no longer belongs to the digest's organisation" };
  }
  if (!call.transcript_id) {
    return { reason: "transcript_gone", detail: "the call no longer has an authoritative transcript" };
  }
  if (call.transcript_id !== digest.transcript_id) {
    // A different transcript is authoritative now - the commonest way a queued
    // digest goes stale.
    return { reason: "stale_source", detail: "a different transcript is now authoritative for this call" };
  }

  const { data: transcript } = await service
    .from("transcript")
    .select("id, call_id, org_id, status, archived_at, version_no, kind, reviewed_at, updated_at, segment_count, segments, speakers")
    .eq("id", digest.transcript_id)
    .maybeSingle();

  if (!transcript) {
    return { reason: "transcript_gone", detail: "the transcript no longer exists" };
  }
  if (
    transcript.call_id !== digest.call_id ||
    transcript.org_id !== digest.org_id ||
    transcript.archived_at !== null ||
    transcript.status !== "available"
  ) {
    return { reason: "transcript_detached", detail: "the transcript no longer belongs to this call and organisation, or is no longer available" };
  }

  const speakerEntries = speakerEntriesFrom(transcript.speakers);
  const segmentCount = (transcript.segment_count as number | null) ?? 0;

  const fingerprintNow = await computeSourceFingerprint({
    transcriptId: transcript.id as string,
    versionNo: (transcript.version_no as number | null) ?? 0,
    kind: (transcript.kind as string | null) ?? "",
    reviewedAt: (transcript.reviewed_at as string | null) ?? null,
    updatedAt: (transcript.updated_at as string | null) ?? null,
    segmentCount,
    speakers: speakerEntries,
  });

  if (fingerprintNow !== digest.source_fingerprint) {
    return { reason: "stale_source", detail: "the transcript has changed since this generation was requested" };
  }

  const byLabel = new Map(speakerEntries.map((s) => [s.label, s]));
  const raw = Array.isArray(transcript.segments) ? transcript.segments : [];
  const segments: SourceSegment[] = raw.map((s, i) => {
    const seg = (s ?? {}) as Record<string, unknown>;
    const label = typeof seg["speaker"] === "string"
      ? (seg["speaker"] as string)
      : typeof seg["speaker_label"] === "string" ? (seg["speaker_label"] as string) : "";
    const who = byLabel.get(label.trim());
    const num = (k: string): number | null => {
      const v = seg[k];
      return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
    };
    return {
      i,
      speaker_label: label.trim(),
      name: who?.name ?? null,
      role: who?.role ?? null,
      start_ms: num("start_ms") ?? num("start"),
      end_ms: num("end_ms") ?? num("end"),
    };
  });

  return {
    segments,
    speakers: speakerEntries,
    callDurationMs: (call.duration_ms as number | null) ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* 3. The structure a provider will one day receive                            */
/* -------------------------------------------------------------------------- */

export interface ProviderInput {
  callId: string;
  callDurationMs: number | null;
  promptVersion: string;
  sourceFingerprint: string;
  segments: SourceSegment[];
  speakers: { label: string; name: string | null; role: string | null }[];
  rubricVersionId: string | null;
  rubricCriteria: { code: string; stage: string | null; label: string; statement: string }[];
}

/**
 * Assembled in memory and SENT NOWHERE in this phase.
 *
 * It is built now so that the shape is settled, reviewable and costed before
 * any of it is put on the wire. Note what is absent: it is never written back
 * into call_digest - duplicating the transcript into the digest row would
 * create a second copy of client content with its own lifetime and its own
 * deletion problem - and it is never logged. Only counts are logged.
 */
function buildProviderInput(
  digest: ClaimedDigest,
  source: ResolvedSource,
  rubricCriteria: ProviderInput["rubricCriteria"],
): ProviderInput {
  return {
    callId: digest.call_id,
    callDurationMs: source.callDurationMs,
    promptVersion: digest.prompt_version,
    sourceFingerprint: digest.source_fingerprint,
    segments: source.segments,
    speakers: source.speakers,
    rubricVersionId: digest.rubric_version_id,
    rubricCriteria,
  };
}

/** Rubric criteria for the digest's recorded version, if there is one. */
export async function loadRubricCriteria(
  service: SupabaseClient,
  rubricVersionId: string | null,
): Promise<ProviderInput["rubricCriteria"]> {
  if (!rubricVersionId) return [];
  const { data } = await service
    .from("rubric_criterion")
    .select("code, stage, label, statement, sort_order")
    .eq("version_id", rubricVersionId)
    .order("sort_order", { ascending: true });
  return (data ?? []).map((c) => ({
    code: c.code as string,
    stage: (c.stage as string | null) ?? null,
    label: c.label as string,
    statement: c.statement as string,
  }));
}

/* -------------------------------------------------------------------------- */
/* 4. Terminal state                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Marks a running digest failed, releasing the one-in-flight slot.
 *
 * Guarded on status = 'running' so a row that something else already moved is
 * left alone. error_message is a machine-readable code, a colon and a fixed
 * explanation: no transcript text, no prompt content, no speaker names, no
 * provider payload - the column is readable by anyone with call.read.
 */
async function markFailed(
  service: SupabaseClient,
  digestId: string,
  code: string,
  detail: string,
): Promise<void> {
  const { error } = await service
    .from("call_digest")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: `${code}: ${detail}`,
    })
    .eq("id", digestId)
    .eq("status", "running")
    .is("archived_at", null);
  if (error) log({ outcome: "mark_failed_error", digest_id: digestId, code: error.code });
}
