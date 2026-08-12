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
}

export interface UploadDraft {
  file: File;
  title: string;
  agentName: string;
  customerRef: string;
  occurredAt: string;
  durationMs: number | null;
}
