import { supabase } from "./supabase";
import { formatDate } from "./format";
import type { CallListItem, UploadDraft } from "./types";

export type UploadStage =
  | { stage: "idle" }
  | { stage: "reading" }
  | { stage: "uploading"; percent: number }
  | { stage: "recording" }
  | { stage: "transcribing" }
  | { stage: "done" }
  | { stage: "error"; message: string };

const BUCKET = "recordings";

const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export const ACCEPTED_EXTENSIONS = ".mp3,.wav,.m4a,.mp4,.aac,.ogg,.webm";
export const MAX_BYTES = 500 * 1024 * 1024;

function extensionFor(file: File): string {
  const fromMime = EXTENSION_BY_MIME[file.type];
  if (fromMime) return fromMime;
  const fromName = file.name.split(".").pop();
  return fromName && fromName.length <= 5 ? fromName.toLowerCase() : "bin";
}

export function validateFile(file: File): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_BYTES) return "That file is larger than 500 MB.";
  const ext = extensionFor(file);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return `${ext.toUpperCase()} files aren't supported. Use MP3, WAV, M4A, or MP4.`;
  }
  return null;
}

export const TITLE_SEPARATOR = " \u00B7 ";
export const REP_NOT_SET = "Rep not set";
export const AUTHOR_NOT_SET = "Author not set";

/**
 * The displayed call title: Representative \u00B7 Author \u00B7 Date.
 *
 * Always three segments and two separators. A missing name becomes a
 * placeholder rather than a dropped segment, because the title is positional:
 * "Tara Aronson \u00B7 26 Aug 2026" gives a reader no way to tell whether that
 * name is the representative or the author.
 *
 * The date always resolves, so the title is never empty and never ends in a
 * dangling separator. occurred_at when the uploader gave one, otherwise the
 * upload date — created_at is a database default and does not exist on the
 * client before the insert.
 *
 * This is a label, never an identifier. Recordings are retrieved by
 * storage_path and recording.id, and nothing here touches either.
 */
export function buildCallTitle(draft: {
  agentName: string;
  authorName: string;
  occurredAt: string;
}): string {
  const rep = draft.agentName.trim() || REP_NOT_SET;
  const author = draft.authorName.trim() || AUTHOR_NOT_SET;
  const when = draft.occurredAt ? new Date(draft.occurredAt) : new Date();
  const safe = Number.isNaN(when.getTime()) ? new Date() : when;
  return [rep, author, formatDate(safe.toISOString())].join(TITLE_SEPARATOR);
}

/**
 * Uploads a recording and records the call.
 *
 * Order matters: the call row is created first so the storage path can contain
 * its id, then the file is uploaded, then the recording row is written. If the
 * upload fails, the call row is archived rather than deleted — nothing in this
 * platform is hard-deleted (INV-11), and an archived orphan is both harmless
 * and a useful trace that an upload was attempted.
 */
export async function uploadCall(
  draft: UploadDraft,
  orgId: string,
  personId: string,
  onProgress: (stage: UploadStage) => void,
): Promise<string> {
  onProgress({ stage: "reading" });

  const { data: call, error: callError } = await supabase
    .from("call")
    .insert({
      org_id: orgId,
      provider: "manual",
      // Generated, never typed and never the filename. The filename is kept
      // verbatim on the recording row below.
      title: buildCallTitle(draft),
      agent_name: draft.agentName.trim(),
      author_name: draft.authorName.trim(),
      // customer_ref is deliberately NOT written any more. The column and its
      // historical values stay exactly as they are; uploads now capture the
      // recording platform's own identifier instead, which is a different fact.
      meeting_id: draft.meetingId.trim(),
      occurred_at: draft.occurredAt ? new Date(draft.occurredAt).toISOString() : null,
      duration_ms: draft.durationMs,
      created_by: personId,
      updated_by: personId,
    })
    .select("id")
    .single<{ id: string }>();

  if (callError || !call) {
    throw new Error(callError?.message ?? "Could not create the call record.");
  }

  const path = `${orgId}/${call.id}/${crypto.randomUUID()}.${extensionFor(draft.file)}`;

  try {
    onProgress({ stage: "uploading", percent: 0 });

    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .upload(path, draft.file, {
        contentType: draft.file.type || "application/octet-stream",
        upsert: false,
      });

    if (storageError) throw new Error(storageError.message);

    onProgress({ stage: "recording" });

    const { error: recordingError } = await supabase.from("recording").insert({
      org_id: orgId,
      call_id: call.id,
      provider: "manual",
      custody: "platform_held",
      storage_path: path,
      original_filename: draft.file.name,
      mime_type: draft.file.type || "application/octet-stream",
      size_bytes: draft.file.size,
      duration_ms: draft.durationMs,
      availability: "available",
      created_by: personId,
      updated_by: personId,
    });

    if (recordingError) throw new Error(recordingError.message);

    onProgress({ stage: "done" });
    return call.id;
  } catch (error) {
    await supabase
      .from("call")
      .update({ archived_at: new Date().toISOString(), updated_by: personId })
      .eq("id", call.id);
    throw error;
  }
}

/**
 * The call states a Raw QA reviewer may still archive their own upload from.
 *
 * Mirrors the guard in archive_own_unsubmitted_call(). Duplicated here only to
 * decide whether to render the control — the database is the authority, and
 * refuses regardless of what this array says.
 */
export const ARCHIVABLE_STATUSES = [
  "draft",
  "ready_for_raw_qa",
  "raw_qa_in_progress",
] as const;

/**
 * Archives a call the signed-in person uploaded, before it reaches a trainer.
 *
 * Not a delete. The recording, its storage object, any transcript and any
 * draft observation all survive; the call simply stops appearing, because
 * every view filters archived_at.
 *
 * Ownership and workflow state are enforced inside the function, which runs
 * security definer and therefore checks the organisation by hand as well —
 * RLS is off in there. The error text comes back from the database, so the
 * reason a refusal happened is the database's own words rather than a guess
 * made here.
 */
export async function archiveCall(callId: string): Promise<void> {
  const { error } = await supabase.rpc("archive_own_unsubmitted_call", {
    p_call_id: callId,
  });
  if (error) throw new Error(error.message);
}

export async function listCalls(): Promise<CallListItem[]> {
  const { data, error } = await supabase
    .from("v_call_list")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);
  return (data ?? []) as CallListItem[];
}

/**
 * Short-lived signed URL. Recordings are never public — these are customer
 * conversations, and every link expires.
 */
export async function signedUrlFor(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60);
  return error ? null : (data?.signedUrl ?? null);
}

// ---- transcripts ---------------------------------------------------------

import type { Segment } from "./transcript";

export interface StoredTranscript {
  id: string;
  call_id: string;
  source_format: string;
  original_filename: string;
  segments: Segment[];
  segment_count: number;
  has_timing: boolean;
  speaker_count: number;
  version_no: number;
  created_at: string;
  kind: "machine" | "reviewed" | "manual";
  supersedes_id: string | null;
  provider: string;
  /** Label to identity. Segments keep the provider's label; this names it. */
  speakers: Record<string, { name?: string; role?: string }>;
}

export async function getCall(callId: string): Promise<CallListItem | null> {
  const { data, error } = await supabase
    .from("v_call_list")
    .select("*")
    .eq("id", callId)
    .maybeSingle<CallListItem>();
  if (error) throw new Error(error.message);
  return data;
}

export async function getTranscript(callId: string): Promise<StoredTranscript | null> {
  const { data, error } = await supabase
    .from("transcript")
    .select("id, call_id, source_format, original_filename, segments, segment_count, has_timing, speaker_count, version_no, created_at, kind, supersedes_id, provider, speakers")
    .eq("call_id", callId)
    .is("archived_at", null)
    .eq("status", "available")
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle<StoredTranscript>();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Saves a transcript. Re-uploading supersedes the previous version rather than
 * overwriting it — evidence anchored to an older transcript must stay
 * resolvable (Domain Blueprint §B).
 */
export async function saveTranscript(params: {
  callId: string;
  orgId: string;
  personId: string;
  recordingId: string | null;
  format: string;
  filename: string;
  segments: Segment[];
}): Promise<void> {
  const existing = await getTranscript(params.callId);

  if (existing) {
    const { error } = await supabase
      .from("transcript")
      .update({ status: "superseded", updated_by: params.personId })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  }

  const { error } = await supabase.from("transcript").insert({
    org_id: params.orgId,
    call_id: params.callId,
    recording_id: params.recordingId,
    provider: "manual",
    source_format: params.format,
    original_filename: params.filename,
    segments: params.segments,
    version_no: (existing?.version_no ?? 0) + 1,
    status: "available",
    created_by: params.personId,
    updated_by: params.personId,
  });
  if (error) throw new Error(error.message);
}

// ---- transcription -------------------------------------------------------

export interface TranscriptionJob {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error_message: string | null;
  attempt: number;
  requested_at: string;
}

/**
 * Asks the backend to transcribe a call.
 *
 * The provider is deliberately not named here — this calls our own endpoint,
 * which holds the credentials and could be pointed at a different provider
 * without changing a line of this file (INV-62).
 */
/**
 * The message an Edge Function actually returned.
 *
 * On a non-2xx, supabase-js does not parse the body: `data` is null and
 * `error` is a FunctionsHttpError whose generic text is "Edge Function
 * returned a non-2xx status code". The real explanation is in the response
 * carried on error.context, so it has to be read from there — otherwise every
 * server-side failure looks identical and nobody can tell a missing secret
 * from a rejected file.
 */
async function functionErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.text === "function") {
    try {
      const body = await context.text();
      if (body) {
        try {
          const parsed = JSON.parse(body) as { error?: string };
          if (parsed?.error) return parsed.error;
        } catch {
          // Not JSON — the raw body is still more useful than the wrapper.
        }
        return body.slice(0, 300);
      }
    } catch {
      // Body already consumed or unreadable; fall through.
    }
  }
  return (error as { message?: string } | null)?.message ?? fallback;
}

export async function requestTranscription(callId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("transcribe", {
    body: { callId },
  });
  if (error) {
    throw new Error(await functionErrorMessage(error, "Transcription failed."));
  }
  if ((data as { error?: string } | null)?.error) {
    throw new Error((data as { error: string }).error);
  }
}

export async function latestJob(callId: string): Promise<TranscriptionJob | null> {
  const { data } = await supabase
    .from("transcription_job")
    .select("id, status, error_message, attempt, requested_at")
    .eq("call_id", callId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle<TranscriptionJob>();
  return data;
}

/**
 * Saves human corrections as a NEW reviewed transcript.
 *
 * The machine original is never modified — a database trigger enforces that,
 * and this is the approved traceability rule: the provider's output stays
 * exactly as it arrived.
 */
export async function saveReviewedTranscript(params: {
  source: StoredTranscript;
  segments: Segment[];
  orgId: string;
  personId: string;
  callId: string;
}): Promise<void> {
  if (params.source.kind === "reviewed") {
    const { error } = await supabase
      .from("transcript")
      .update({
        segments: params.segments,
        reviewed_at: new Date().toISOString(),
        reviewed_by: params.personId,
        updated_by: params.personId,
      })
      .eq("id", params.source.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("transcript").insert({
    org_id: params.orgId,
    call_id: params.callId,
    kind: "reviewed",
    provider: "manual",
    source_format: params.source.source_format,
    segments: params.segments,
    version_no: params.source.version_no + 1,
    supersedes_id: params.source.id,
    status: "available",
    reviewed_at: new Date().toISOString(),
    reviewed_by: params.personId,
    created_by: params.personId,
    updated_by: params.personId,
  });
  if (error) throw new Error(error.message);
}
