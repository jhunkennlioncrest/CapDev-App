/** Domain identity. Distinct from the Supabase auth record (Domain Blueprint §6.2). */
export interface Person {
  id: string;
  org_id: string;
  email: string;
  display_name: string;
  status: "invited" | "active" | "suspended" | "offboarded" | "archived";
}

export interface Session {
  person: Person;
  permissions: string[];
}

/** One row of the call list, joined to its primary recording. */
export interface CallListItem {
  id: string;
  org_id: string;
  title: string;
  agent_name: string;
  customer_ref: string;
  occurred_at: string | null;
  duration_ms: number | null;
  direction: "inbound" | "outbound" | "internal" | "unknown";
  status: string;
  created_at: string;
  recording_id: string | null;
  storage_path: string | null;
  original_filename: string | null;
  size_bytes: number | null;
  availability: string | null;
  transcript_id: string | null;
  segment_count: number;
  has_timing: boolean;
  transcript_kind: "machine" | "reviewed" | "manual" | null;
  transcription_status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | null;
  transcription_error: string | null;
  workflow_status: import("./workflow").WorkflowStatus;
  /** Human-readable author name. Feeds the generated title (0062). */
  author_name: string;
  /** Recording-platform identifier, e.g. a Zoom meeting ID (0063). Kept
   *  separate from customer_ref, and never part of the title. */
  meeting_id: string;
  /** Optional description. Searchable; never an identifier (0062). */
  notes: string;
}

/**
 * What the upload form collects.
 *
 * There is no `title`: the displayed title is generated from the
 * representative, the author and the date. Nothing typed here becomes the
 * title, and the filename never does — that is kept, untouched, as
 * recording.original_filename.
 */
export interface UploadDraft {
  file: File;
  agentName: string;
  authorName: string;
  meetingId: string;
  occurredAt: string;
  durationMs: number | null;
}
