import { supabase } from "./supabase";

/**
 * Quick Listen generation requests (0075 Phase 2).
 *
 * The browser sends one thing - which call - and is told what happened. Every
 * other input (organisation, transcript, rubric version, prompt version,
 * status) is derived inside the Edge Function from the database; this module
 * deliberately has no way to supply them, because the function refuses a body
 * carrying anything but call_id.
 *
 * Nothing here is playable yet. The function queues work; it never produces
 * audio, and Phase 2 never moves a digest to 'ready'.
 */

export type QuickListenOutcome =
  /** A digest is queued or already running. Nothing to play. */
  | { kind: "preparing"; state: "queued" | "running"; digestId: string; reused: boolean }
  /** A finished digest exists. Audio arrives in a later phase. */
  | { kind: "prepared"; digestId: string; reused: boolean }
  /** A domain answer, not a failure: this call cannot have one right now. */
  | { kind: "unavailable"; message: string }
  /** Something went wrong, or the caller may not do this. */
  | { kind: "error"; message: string };

/** Plain-language wording for each machine reason the server can return. */
const REASON_TEXT: Record<string, string> = {
  duration_under_30_minutes:
    "Quick Listen is only offered for calls of 30 minutes or more.",
  no_authoritative_transcript:
    "This call has no transcript yet, so there is nothing to condense.",
  transcript_has_no_segments:
    "The transcript for this call is empty, so there is nothing to condense.",
  not_permitted: "You are not authorised to generate a Quick Listen.",
  call_not_found: "That call does not exist.",
  generation_race_unresolved:
    "Another request is already preparing this call. Try again in a moment.",
};

interface ServerBody {
  status?: string;
  reason?: string;
  message?: string;
  digest_id?: string;
  reused?: boolean;
}

export async function requestQuickListen(
  callId: string,
): Promise<QuickListenOutcome> {
  const { data, error } = await supabase.functions.invoke("quick-listen", {
    body: { call_id: callId },
  });

  // A non-2xx reply is delivered as an error with the raw Response attached.
  // The body still carries the reason, and the reason is the useful part - a
  // bare "Edge Function returned a non-2xx status code" tells the reviewer
  // nothing about whether they lack permission or the call has no transcript.
  if (error) {
    const body = await readErrorBody(error);
    if (body?.reason) return fromReason(body.reason, body.message);
    return {
      kind: "error",
      message: "Quick Listen could not be requested. Please try again.",
    };
  }

  const body = (data ?? {}) as ServerBody;

  switch (body.status) {
    case "queued":
    case "running":
      return body.digest_id
        ? {
            kind: "preparing",
            state: body.status,
            digestId: body.digest_id,
            reused: body.reused === true,
          }
        : { kind: "error", message: "Quick Listen returned an unexpected reply." };
    case "ready":
      return body.digest_id
        ? { kind: "prepared", digestId: body.digest_id, reused: body.reused === true }
        : { kind: "error", message: "Quick Listen returned an unexpected reply." };
    case "not_eligible":
    case "not_ready":
      return fromReason(body.reason ?? "", body.message);
    default:
      return { kind: "error", message: "Quick Listen returned an unexpected reply." };
  }
}

function fromReason(reason: string, serverMessage?: string): QuickListenOutcome {
  const text = REASON_TEXT[reason] ?? serverMessage ??
    "Quick Listen could not be requested. Please try again.";
  const isDomain =
    reason === "duration_under_30_minutes" ||
    reason === "no_authoritative_transcript" ||
    reason === "transcript_has_no_segments";
  return isDomain ? { kind: "unavailable", message: text } : { kind: "error", message: text };
}

async function readErrorBody(error: unknown): Promise<ServerBody | null> {
  const context = (error as { context?: unknown }).context;
  if (!context || typeof (context as Response).json !== "function") return null;
  try {
    return (await (context as Response).json()) as ServerBody;
  } catch {
    return null;
  }
}
