import { supabase } from "./supabase";

/**
 * Calibration is validation, not a second evaluation.
 *
 * The question is whether the reviewer read the rubric correctly — so both
 * answers are kept, side by side, permanently, and every disagreement is
 * classified rather than merely recorded.
 */

export type Answer = "yes" | "no" | "na";
export type Variance = "agreed" | "missed_failure" | "false_failure" | "scope_change";

export interface EvidenceItem {
  id: string;
  start_ms: number | null;
  end_ms: number | null;
  excerpt: string;
  note: string;
}

export interface CalibrationRow {
  score_id: string;
  criterion_id: string;
  code: string;
  label: string;
  statement: string;
  guidance: string[];
  na_condition: string;
  stage: string;
  section_code: string;
  section_title: string;
  section_kind: "checklist" | "non_negotiable";
  sort_order: number;

  raw_value: Answer | null;
  raw_remark: string;
  raw_updated_at: string | null;
  raw_evidence: EvidenceItem[];

  value: Answer | null;
  remark: string;
  calibrated_at: string | null;
  variance: Variance | null;
  trainer_evidence: EvidenceItem[];
  /** What still stands between this criterion and submission. */
  blocker: "not_calibrated" | "needs_evidence" | "needs_justification" | null;
}

export interface CalibrationSummary {
  evaluation_id: string;
  reviewer_name: string | null;
  trainer_name: string | null;
  version_label: string | null;
  criteria_compared: number;
  agreed: number;
  changed: number;
  missed_failures: number;
  false_failures: number;
  scope_changes: number;
  not_yet_calibrated: number;
  agreement_rate: number | null;
}

export const VARIANCE_LABELS: Record<Variance, { label: string; meaning: string; colour: string }> =
  {
    agreed: { label: "Agreed", meaning: "", colour: "#1F7A4D" },
    missed_failure: {
      label: "Missed failure",
      meaning: "The reviewer passed something that should have failed.",
      colour: "#AC3A2A",
    },
    false_failure: {
      label: "False failure",
      meaning: "The reviewer failed something that met the rubric.",
      colour: "#96690A",
    },
    scope_change: {
      label: "Scope change",
      meaning: "Disagreement about whether the criterion applied at all.",
      colour: "#2C6E9B",
    },
  };

export async function getCalibrationRows(evaluationId: string): Promise<CalibrationRow[]> {
  const { data: scores, error } = await supabase
    .from("evaluation_score")
    .select(
      "id, criterion_id, value, remark, raw_value, raw_remark, raw_updated_at, calibrated_at, variance",
    )
    .eq("evaluation_id", evaluationId);
  if (error) throw new Error(error.message);

  const rows = (scores ?? []) as {
    id: string;
    criterion_id: string;
    value: Answer | null;
    remark: string;
    raw_value: Answer | null;
    raw_remark: string;
    raw_updated_at: string | null;
    calibrated_at: string | null;
    variance: Variance | null;
  }[];

  if (rows.length === 0) return [];

  const [{ data: criteria }, { data: observations }] = await Promise.all([
    supabase
      .from("v_rubric_criteria_flat")
      .select("*")
      .in(
        "criterion_id",
        rows.map((r) => r.criterion_id),
      ),
    // The reviewer's complete observation: their evidence is read from where
    // they cited it, never copied onto the trainer's row.
    supabase
      .from("v_raw_observation")
      .select("criterion_id, evidence")
      .eq("calibration_id", evaluationId),
  ]);

  // The trainer's own citations, and what is still outstanding per criterion.
  const [{ data: readiness }, { data: mine }] = await Promise.all([
    supabase
      .from("v_calibration_readiness")
      .select("criterion_id, blocker")
      .eq("evaluation_id", evaluationId),
    supabase
      .from("evidence")
      .select("id, subject_id, start_ms, end_ms, excerpt, note")
      .eq("subject_type", "evaluation_score")
      .in(
        "subject_id",
        rows.map((r) => r.id),
      ),
  ]);

  const blockerByCriterion = new Map(
    ((readiness ?? []) as { criterion_id: string; blocker: CalibrationRow["blocker"] }[]).map(
      (r) => [r.criterion_id, r.blocker],
    ),
  );

  const trainerEvidenceByScore = new Map<string, EvidenceItem[]>();
  for (const e of (mine ?? []) as (EvidenceItem & { subject_id: string })[]) {
    const list = trainerEvidenceByScore.get(e.subject_id) ?? [];
    list.push(e);
    trainerEvidenceByScore.set(e.subject_id, list);
  }

  const evidenceByCriterion = new Map(
    ((observations ?? []) as { criterion_id: string; evidence: EvidenceItem[] }[]).map((o) => [
      o.criterion_id,
      o.evidence ?? [],
    ]),
  );

  const byId = new Map(
    ((criteria ?? []) as Record<string, unknown>[]).map((c) => [c["criterion_id"] as string, c]),
  );

  return rows
    .map((r) => {
      const c = byId.get(r.criterion_id) ?? {};
      return {
        score_id: r.id,
        criterion_id: r.criterion_id,
        code: (c["code"] as string) ?? "",
        label: (c["label"] as string) ?? "",
        statement: (c["statement"] as string) ?? "",
        guidance: (c["guidance"] as string[]) ?? [],
        na_condition: (c["na_condition"] as string) ?? "",
        stage: (c["stage"] as string) ?? "",
        section_code: (c["section_code"] as string) ?? "",
        section_title: (c["section_title"] as string) ?? "",
        section_kind: (c["section_kind"] as "checklist" | "non_negotiable") ?? "checklist",
        sort_order: (c["sort_order"] as number) ?? 0,
        raw_value: r.raw_value,
        raw_remark: r.raw_remark,
        raw_updated_at: r.raw_updated_at,
        raw_evidence: evidenceByCriterion.get(r.criterion_id) ?? [],
        trainer_evidence: (trainerEvidenceByScore.get(r.id) ?? []).sort(
          (a, b) => (a.start_ms ?? 0) - (b.start_ms ?? 0),
        ),
        blocker: blockerByCriterion.get(r.criterion_id) ?? null,
        value: r.value,
        remark: r.remark,
        calibrated_at: r.calibrated_at,
        variance: r.variance,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order);
}

export async function getSummary(evaluationId: string): Promise<CalibrationSummary | null> {
  const { data } = await supabase
    .from("v_calibration_summary")
    .select("*")
    .eq("evaluation_id", evaluationId)
    .maybeSingle<CalibrationSummary>();
  return data;
}

/** Agreeing and changing are the same act: a judgement, recorded. */
export async function decide(params: {
  evaluationId: string;
  criterionId: string;
  value: Answer;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("calibrate_criterion", {
    p_evaluation_id: params.evaluationId,
    p_criterion_id: params.criterionId,
    p_value: params.value,
    p_note: params.note ?? null,
  });
  if (error) throw new Error(error.message);
}

/** One deliberate act covering everything still undecided. */
export async function agreeWithRemaining(evaluationId: string): Promise<number> {
  const { data, error } = await supabase.rpc("agree_with_remaining", {
    p_evaluation_id: evaluationId,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}


/**
 * Adopts one of the reviewer's citations as the trainer's own.
 *
 * Sometimes the reviewer quoted exactly the right passage and read it the
 * wrong way. Adopting says "this quote, different conclusion".
 */
export async function adoptReviewerEvidence(
  scoreId: string,
  evidenceId: string,
): Promise<void> {
  const { error } = await supabase.rpc("adopt_reviewer_evidence", {
    p_score_id: scoreId,
    p_evidence_id: evidenceId,
  });
  if (error) throw new Error(error.message);
}

export async function citeEvidence(params: {
  orgId: string;
  personId: string;
  scoreId: string;
  callId: string;
  startMs: number | null;
  endMs: number | null;
  excerpt: string;
}): Promise<void> {
  const { error } = await supabase.from("evidence").insert({
    org_id: params.orgId,
    subject_type: "evaluation_score",
    subject_id: params.scoreId,
    call_id: params.callId,
    start_ms: params.startMs,
    end_ms: params.endMs,
    excerpt: params.excerpt,
    created_by: params.personId,
  });
  if (error) throw new Error(error.message);
}

export async function removeEvidence(id: string): Promise<void> {
  const { error } = await supabase.from("evidence").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** mm:ss in, milliseconds out. Trainers think in clock time. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(":").map((p) => p.trim());
  if (parts.some((p) => p === "" || Number.isNaN(Number(p)))) return null;
  if (parts.length === 1) return Number(parts[0]) * 1000;
  if (parts.length === 2) return (Number(parts[0]) * 60 + Number(parts[1])) * 1000;
  if (parts.length === 3)
    return (Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])) * 1000;
  return null;
}


// ---------------------------------------------------------------------------
// Teaching moments, captured during calibration
//
// The trainer is already listening to the call and has already cited the
// passage. Making them re-select it in the Library later is asking for the
// same work twice.

export const MOMENT_KINDS: { value: string; label: string; hint: string }[] = [
  { value: "model", label: "Model", hint: "The intended behaviour, demonstrated" },
  { value: "kudos", label: "Kudos", hint: "Exceptional execution, beyond the requirement" },
  { value: "miss", label: "Miss", hint: "The expected behaviour was missed or failed" },
  { value: "cautionary", label: "Cautionary", hint: "Needs attention for risk, impact or coaching" },
];

/**
 * Builds a teaching moment from evidence that already exists.
 *
 * The clip keeps the exact boundaries it was cited with, and the criterion and
 * calibration travel with it.
 */
export async function momentFromEvidence(params: {
  evidenceId: string;
  title: string;
  coachingNote: string;
  momentType: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("moment_from_evidence", {
    p_evidence_id: params.evidenceId,
    p_title: params.title,
    p_coaching_note: params.coachingNote,
    p_moment_type: params.momentType,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
