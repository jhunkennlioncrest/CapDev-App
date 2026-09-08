import { supabase } from "./supabase";

/**
 * Original upload filenames, for traceability only (0071).
 *
 * This answers one question the generated call title cannot: "which file did I
 * upload?" It is how a call in here is matched back to the recording in Zoom,
 * a shared drive, or an email thread.
 *
 * It is reference metadata and nothing else. It never becomes the title, never
 * names the representative or the author, and it is not a storage path — the
 * name is read straight from v_call_recording_files, so displaying it needs no
 * signed URL and grants no access to the audio.
 *
 * The source is recording.original_filename. NOT transcript.original_filename,
 * which is a different column recording where a transcript was imported from,
 * and which is frequently a .vtt or .json that was never the uploaded call.
 */
export interface CallRecordingFiles {
  call_id: string;
  /** Ordered created_at then id — the upload order, deterministic on ties. */
  recording_filenames: string[];
  /** Recordings behind the names, so the label can stay honest about count. */
  recording_file_count: number;
}

/**
 * Fetches filenames for calls already on screen, in one round trip.
 *
 * Deliberately a second query rather than a column added to five existing
 * views: four of those five have no source in this repository, and rebuilding
 * a view from pg_get_viewdef() loses its reloptions — which is how a
 * security_invoker view silently becomes a definer view and stops enforcing
 * cross-org RLS. One indexed lookup is the cheaper risk.
 */
export async function getRecordingFiles(
  callIds: string[],
): Promise<Map<string, CallRecordingFiles>> {
  const ids = Array.from(new Set(callIds.filter(Boolean)));
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("v_call_recording_files")
    .select("call_id, recording_filenames, recording_file_count")
    .in("call_id", ids);

  // Traceability metadata is not worth failing a worklist over. A reviewer
  // with no filename line can still do the review; a reviewer staring at an
  // error instead of their queue cannot.
  if (error) return new Map();

  const map = new Map<string, CallRecordingFiles>();
  for (const row of (data ?? []) as CallRecordingFiles[]) {
    map.set(row.call_id, row);
  }
  return map;
}
