import { supabase } from "./supabase";
import type { Segment } from "./transcript";

export type MomentType = "model" | "kudos" | "miss" | "cautionary";

/**
 * The four settled categories.
 *
 * Curated for teaching value, deliberately not derived from the score — one
 * call can carry all four at different moments.
 */
export const MOMENT_TYPES: { value: MomentType; label: string; hint: string }[] = [
  { value: "model", label: "Model", hint: "The intended behaviour, demonstrated" },
  { value: "kudos", label: "Kudos", hint: "Exceptional execution, beyond the requirement" },
  { value: "miss", label: "Miss", hint: "The expected behaviour was missed or failed" },
  { value: "cautionary", label: "Cautionary", hint: "Needs attention for risk, impact or coaching" },
];

export interface Moment {
  id: string;
  call_id: string;
  title: string;
  coaching_note: string;
  moment_type: MomentType;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  criterion_ids: string[];
  excerpt: string;
  status: string;
  created_at: string;
  call_title?: string;
  agent_name?: string;
  /** Optional call description (0062). Searched alongside call_title. */
  call_notes?: string;
}

export interface Evidence {
  id: string;
  subject_type: string;
  subject_id: string;
  call_id: string;
  moment_id: string | null;
  start_ms: number | null;
  end_ms: number | null;
  excerpt: string;
  note: string;
}

/**
 * A contiguous run of selected transcript lines.
 *
 * Evidence must represent exactly what was selected, so a selection with gaps
 * becomes several runs rather than one span from first to last. The audio
 * between two runs was never cited and must never play as though it was.
 */
export interface SelectionRun {
  indices: number[];
  segments: Segment[];
  startMs: number | null;
  endMs: number | null;
  excerpt: string;
}

/**
 * Splits selected line indices into contiguous runs.
 *
 * Adjacency is by line position, not by timestamp: two consecutive lines are
 * one run even if the recording has a pause between them, because that is what
 * the reader selected. A skipped line starts a new run.
 */
export function contiguousRuns(
  selectedIndices: number[],
  allSegments: Segment[],
): SelectionRun[] {
  const sorted = [...new Set(selectedIndices)].sort((a, b) => a - b);
  if (sorted.length === 0) return [];

  const runs: number[][] = [];
  let current: number[] = [sorted[0] as number];

  for (let k = 1; k < sorted.length; k++) {
    const i = sorted[k] as number;
    const prev = sorted[k - 1] as number;
    if (i === prev + 1) current.push(i);
    else {
      runs.push(current);
      current = [i];
    }
  }
  runs.push(current);

  return runs.map((indices) => {
    const segs = indices
      .map((i) => allSegments[i])
      .filter((x): x is Segment => Boolean(x));
    return {
      indices,
      segments: segs,
      startMs: segs[0]?.start_ms ?? null,
      endMs: segs[segs.length - 1]?.end_ms ?? null,
      excerpt: excerptFrom(segs),
    };
  });
}

/** Joins the selected transcript lines into a readable excerpt. */
export function excerptFrom(segments: Segment[]): string {
  return segments
    .map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
    .join("\n")
    .slice(0, 2000);
}

export async function createMoment(params: {
  orgId: string;
  personId: string;
  callId: string;
  transcriptId: string | null;
  title: string;
  coachingNote: string;
  momentType: MomentType;
  startMs: number;
  endMs: number;
  criterionIds: string[];
  excerpt: string;
}): Promise<Moment> {
  const { data, error } = await supabase
    .from("moment")
    .insert({
      org_id: params.orgId,
      call_id: params.callId,
      transcript_id: params.transcriptId,
      title: params.title.trim(),
      coaching_note: params.coachingNote.trim(),
      moment_type: params.momentType,
      start_ms: params.startMs,
      end_ms: params.endMs,
      criterion_ids: params.criterionIds,
      excerpt: params.excerpt,
      created_by: params.personId,
      updated_by: params.personId,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return { ...(data as Moment), duration_ms: params.endMs - params.startMs };
}

export async function listMomentsForCall(callId: string): Promise<Moment[]> {
  const { data, error } = await supabase
    .from("v_moment_list")
    .select("*")
    .eq("call_id", callId)
    .order("start_ms");
  if (error) throw new Error(error.message);
  return (data ?? []) as Moment[];
}

/**
 * Attaches proof to a score.
 *
 * A moment is optional: sometimes the evidence is just "these seconds", with no
 * intention of turning it into reusable teaching material. Requiring a moment
 * every time would make evidence expensive and people would stop citing it.
 */
export async function attachEvidence(params: {
  orgId: string;
  personId: string;
  scoreId: string;
  callId: string;
  transcriptId: string | null;
  momentId?: string | null;
  startMs: number | null;
  endMs: number | null;
  excerpt: string;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.from("evidence").insert({
    org_id: params.orgId,
    subject_type: "evaluation_score",
    subject_id: params.scoreId,
    call_id: params.callId,
    transcript_id: params.transcriptId,
    moment_id: params.momentId ?? null,
    start_ms: params.startMs,
    end_ms: params.endMs,
    excerpt: params.excerpt,
    note: params.note ?? "",
    created_by: params.personId,
  });
  if (error) throw new Error(error.message);
}

export async function removeEvidence(evidenceId: string): Promise<void> {
  const { error } = await supabase.from("evidence").delete().eq("id", evidenceId);
  if (error) throw new Error(error.message);
}

/** Evidence for every score on an evaluation, keyed by score id. */
export async function evidenceForEvaluation(
  scoreIds: string[],
): Promise<Record<string, Evidence[]>> {
  if (scoreIds.length === 0) return {};
  const { data, error } = await supabase
    .from("evidence")
    .select("id, subject_type, subject_id, call_id, moment_id, start_ms, end_ms, excerpt, note")
    .eq("subject_type", "evaluation_score")
    .in("subject_id", scoreIds);
  if (error) throw new Error(error.message);

  const byScore: Record<string, Evidence[]> = {};
  for (const row of (data ?? []) as Evidence[]) {
    (byScore[row.subject_id] ??= []).push(row);
  }
  return byScore;
}

/** Score rows carry ids so evidence can reference them. */
export async function getScoreIds(evaluationId: string): Promise<Record<string, string>> {
  const { data } = await supabase
    .from("evaluation_score")
    .select("id, criterion_id")
    .eq("evaluation_id", evaluationId);
  return Object.fromEntries(
    ((data ?? []) as { id: string; criterion_id: string }[]).map((r) => [r.criterion_id, r.id]),
  );
}
