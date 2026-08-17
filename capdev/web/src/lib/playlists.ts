import { supabase } from "./supabase";
import type { WorkflowStatus } from "./workflow";

export interface PlaylistSummary {
  id: string;
  kind: "raw_qa" | "learning";
  name: string;
  description: string;
  is_auto: boolean;
  period_start: string | null;
  period_end: string | null;
  status: "active" | "archived";
  created_at: string;
  created_by: string | null;
  steward_id: string | null;
  author_name: string | null;
  steward_name: string | null;
  call_count: number;
  calibrated_count: number;
  escalation_count: number;
  last_added_at: string | null;
}

export interface PlaylistCall {
  playlist_id: string;
  sort_order: number;
  added_at: string;
  note: string;
  call_id: string;
  call_title: string;
  agent_name: string | null;
  duration_ms: number | null;
  workflow_status: WorkflowStatus;
  raw_evaluation_id: string | null;
  raw_submitted_at: string | null;
  is_high_risk: boolean | null;
  flagged_count: number | null;
  reviewer_name: string | null;
  calibrated_evaluation_id: string | null;
  overall_score: number | null;
  calibration_status: string | null;
}

export async function listPlaylists(
  kind: "raw_qa" | "learning",
  includeArchived = false,
): Promise<PlaylistSummary[]> {
  let q = supabase
    .from("v_playlist_summary")
    .select("*")
    .eq("kind", kind)
    .order("created_at", { ascending: false });
  if (!includeArchived) q = q.eq("status", "active");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as PlaylistSummary[];
}

export async function getPlaylist(id: string): Promise<PlaylistSummary | null> {
  const { data } = await supabase
    .from("v_playlist_summary")
    .select("*")
    .eq("id", id)
    .maybeSingle<PlaylistSummary>();
  return data;
}

export async function getPlaylistContents(playlistId: string): Promise<PlaylistCall[]> {
  const { data, error } = await supabase
    .from("v_playlist_contents")
    .select("*")
    .eq("playlist_id", playlistId)
    .order("sort_order")
    .order("added_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as PlaylistCall[];
}

/** Learning playlists are deliberate; raw QA playlists create themselves. */
export async function createLearningPlaylist(params: {
  orgId: string;
  personId: string;
  name: string;
  description?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from("playlist")
    .insert({
      org_id: params.orgId,
      kind: "learning",
      name: params.name.trim(),
      description: params.description ?? "",
      created_by: params.personId,
      steward_id: params.personId,
      is_auto: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function addCallToPlaylist(
  playlistId: string,
  callId: string,
  personId: string,
): Promise<void> {
  const { error } = await supabase
    .from("playlist_call")
    .insert({ playlist_id: playlistId, call_id: callId, added_by: personId });
  if (error && !error.message.includes("duplicate")) throw new Error(error.message);
}

export async function removeCallFromPlaylist(
  playlistId: string,
  callId: string,
): Promise<void> {
  const { error } = await supabase
    .from("playlist_call")
    .delete()
    .eq("playlist_id", playlistId)
    .eq("call_id", callId);
  if (error) throw new Error(error.message);
}

/** Archive, never delete: a playlist records work that was done. */
export async function archivePlaylist(id: string, personId: string): Promise<void> {
  const { error } = await supabase
    .from("playlist")
    .update({ status: "archived", archived_at: new Date().toISOString(), archived_by: personId })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
