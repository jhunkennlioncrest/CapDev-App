import { supabase } from "./supabase";

/**
 * Speaker identity.
 *
 * A transcript segment stores the label the provider assigned — "Speaker 1" —
 * and that label never changes. Who "Speaker 1" is lives in one place on the
 * transcript and is resolved at display time, so renaming updates one row and
 * every line follows.
 *
 * Keeping identity apart from content is what lets a machine transcript stay
 * immutable while still being identified: naming who spoke is not editing what
 * was said.
 */

export interface SpeakerIdentity {
  name?: string;
  role?: string;
}

export type SpeakerMap = Record<string, SpeakerIdentity>;

export interface SpeakerRow {
  label: string;
  name: string | null;
  role: string | null;
  display_name: string;
  segment_count: number;
}

/** Roles offered as shortcuts. Anything else can be typed. */
export const SUGGESTED_ROLES = ["Representative", "Author", "Manager", "Guest"];

export async function getSpeakers(transcriptId: string): Promise<SpeakerRow[]> {
  const { data, error } = await supabase
    .from("v_transcript_speakers")
    .select("label, name, role, display_name, segment_count")
    .eq("transcript_id", transcriptId)
    .order("label");
  if (error) throw new Error(error.message);
  return (data ?? []) as SpeakerRow[];
}

export async function nameSpeaker(params: {
  transcriptId: string;
  label: string;
  name?: string | null;
  role?: string | null;
}): Promise<SpeakerMap> {
  const { data, error } = await supabase.rpc("name_speaker", {
    p_transcript_id: params.transcriptId,
    p_label: params.label,
    p_name: params.name ?? null,
    p_role: params.role ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as SpeakerMap;
}

/**
 * How a speaker should read on a transcript line.
 *
 * Falls back to the provider's label, so an unnamed speaker is never blank —
 * naming is optional and a transcript stays readable without it.
 */
export function displaySpeaker(label: string | null, speakers: SpeakerMap): string {
  if (!label) return "";
  const identity = speakers[label];
  if (!identity) return label;

  const name = identity.name?.trim();
  const role = identity.role?.trim();

  if (name && role) return `${role} — ${name}`;
  return name || role || label;
}

/** The short form, for a line of dialogue where the role is already known. */
export function shortSpeaker(label: string | null, speakers: SpeakerMap): string {
  if (!label) return "";
  const identity = speakers[label];
  return identity?.name?.trim() || identity?.role?.trim() || label;
}
