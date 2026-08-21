import { supabase } from "./supabase";

/**
 * The call's lifecycle. This is the application's source of truth for where
 * work sits — the worklists are filters over it, not owners of it.
 */
export type WorkflowStatus =
  | "draft"
  | "ready_for_raw_qa"
  | "raw_qa_in_progress"
  | "waiting_for_calibration"
  | "calibration_in_progress"
  | "completed"
  | "published";

/**
 * Timeline stages shown to users. Fewer than the status values: the two
 * "in progress" states share a stage with the waiting state they follow,
 * because to a reader "someone is doing it" and "it needs doing" are the same
 * point in the journey.
 */
export const WORKFLOW_STEPS = [
  { key: "uploaded", label: "Uploaded" },
  { key: "transcript", label: "Transcript" },
  { key: "raw_qa", label: "Raw QA" },
  { key: "calibration", label: "Calibration" },
  { key: "published", label: "Published" },
] as const;

export function stageIndexFor(status: WorkflowStatus): number {
  switch (status) {
    case "draft":
      return 0;
    case "ready_for_raw_qa":
      return 1;
    case "raw_qa_in_progress":
    case "waiting_for_calibration":
      return 2;
    case "calibration_in_progress":
    case "completed":
      return 3;
    case "published":
      return 4;
  }
}

export interface RawWorklistItem {
  call_id: string;
  call_title: string;
  agent_name: string | null;
  duration_ms: number | null;
  uploaded_at: string;
  workflow_status: WorkflowStatus;
  has_transcript: boolean;
  segment_count: number;
  draft_evaluation_id: string | null;
  reviewer_name: string | null;
  has_recording: boolean;
  transcription_status: string | null;
  next_step:
    | "needs_audio"
    | "transcribing"
    | "transcription_failed"
    | "needs_transcript"
    | "in_progress"
    | "ready";
}

export async function getRawWorklist(): Promise<RawWorklistItem[]> {
  const { data, error } = await supabase
    .from("v_raw_qa_worklist")
    .select("*")
    .order("uploaded_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RawWorklistItem[];
}

/**
 * Opens calibration for a call regardless of whether raw observations exist.
 * Where they do, the reviewer's work is carried forward; where they don't, an
 * empty calibration opens. Either way no duplicate evaluation is created.
 */
export async function startDirectCalibration(callId: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_direct_calibration", {
    p_call_id: callId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}


/**
 * Marks a call for direct trainer calibration.
 *
 * No raw observation is created — the call simply joins the calibration queue
 * once it has a transcript, and its evaluation will honestly have nothing
 * behind it.
 */
export async function setDirectPath(callId: string): Promise<void> {
  const { error } = await supabase.rpc("set_direct_path", { p_call_id: callId });
  if (error) throw new Error(error.message);
}
