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
  /** When set, the name is resolved from the directory rather than stored. */
  representative_id?: string;
}

export type SpeakerMap = Record<string, SpeakerIdentity>;

export interface SpeakerRow {
  label: string;
  name: string | null;
  role: string | null;
  representative_id: string | null;
  employee_ref: string | null;
  display_name: string;
  segment_count: number;
}

/** Roles offered as shortcuts. Anything else can be typed. */
export const SUGGESTED_ROLES = ["Representative", "Author", "Manager", "Guest"];

export async function getSpeakers(transcriptId: string): Promise<SpeakerRow[]> {
  const { data, error } = await supabase
    .from("v_transcript_speakers")
    .select("label, name, role, representative_id, employee_ref, display_name, segment_count")
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
  /** Identifies this speaker as a representative from the directory. */
  representativeId?: string | null;
}): Promise<SpeakerMap> {
  const { data, error } = await supabase.rpc("name_speaker", {
    p_transcript_id: params.transcriptId,
    p_label: params.label,
    p_name: params.name ?? null,
    p_role: params.role ?? null,
    p_representative_id: params.representativeId ?? null,
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

// ---------------------------------------------------------------------------
// Resolving names in stored text
//
// Excerpts are captured as "Speaker 1: ..." — the provider's label, which is a
// stable reference key rather than a name. Resolving it at display time is
// what lets a rename reach evidence that was cited months earlier, without
// rewriting a single stored record.

/** Matches a leading speaker label on a line: "Speaker 1: hello". */
const LABEL_AT_LINE_START = /^([^:\n]{1,60}):\s?/;

/**
 * Replaces speaker labels in stored text with their assigned names.
 *
 * Only substitutes labels the transcript actually knows about, and only at the
 * start of a line, so dialogue containing a colon is left alone. An excerpt
 * spanning several speakers resolves each line independently.
 */
export function resolveSpeakersInText(text: string, speakers: SpeakerMap): string {
  if (!text || Object.keys(speakers).length === 0) return text;

  return text
    .split("\n")
    .map((line) => {
      const match = LABEL_AT_LINE_START.exec(line);
      if (!match) return line;

      const label = match[1]?.trim();
      if (!label || !speakers[label]) return line;

      const resolved = shortSpeaker(label, speakers);
      if (resolved === label) return line;

      return `${resolved}: ${line.slice(match[0].length)}`;
    })
    .join("\n");
}

/**
 * The canonical speaker mapping for a call.
 *
 * One source, read from the transcript, shared by every surface that shows
 * transcript-derived text. A screen that needs speaker names asks for this
 * rather than keeping its own copy — which is what stops the two drifting
 * apart the way they just did.
 */
export async function speakersForCall(callId: string): Promise<SpeakerMap> {
  const { data } = await supabase
    .from("transcript")
    .select("speakers")
    .eq("call_id", callId)
    .is("archived_at", null)
    .eq("status", "available")
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle<{ speakers: SpeakerMap }>();
  return data?.speakers ?? {};
}
