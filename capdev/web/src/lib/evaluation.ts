import { supabase } from "./supabase";

export type ScoreValue = "yes" | "no" | "na";

export interface Criterion {
  id: string;
  code: string;
  stage: string;
  label: string;
  statement: string;
  guidance: string[];
  na_condition: string;
  sort_order: number;
  section_id: string;
}

export interface RubricSection {
  id: string;
  code: string;
  title: string;
  kind: "checklist" | "non_negotiable";
  description: string;
  sort_order: number;
  criteria: Criterion[];
}

export interface RubricVersion {
  id: string;
  version_label: string;
  title: string;
  effective_date: string | null;
  status: "draft" | "active" | "archived";
  change_summary: string;
  sections: RubricSection[];
}

export interface Evaluation {
  id: string;
  call_id: string;
  rubric_version_id: string;
  evaluator_id: string | null;
  status: "draft" | "submitted" | "superseded";
  yes_count: number;
  no_count: number;
  na_count: number;
  applicable_count: number;
  overall_score: number | null;
  checklist_all_yes: boolean | null;
  non_negotiables_all_pass: boolean | null;
  author_end_state: string | null;
  is_high_risk: boolean;
  reward_tier: "none" | "kudos" | "premium" | null;
  summary_note: string;
  submitted_at: string | null;
  created_at: string;
  kind: EvaluationKind;
  derived_from_id: string | null;
  escalation_note: string;
}

export interface ScoreRow {
  criterion_id: string;
  value: ScoreValue | null;
  raw_value: ScoreValue | null;
  remark: string;
}

/** The rubric an evaluation must be scored against. */
export async function getActiveRubric(): Promise<RubricVersion | null> {
  const { data: version, error } = await supabase
    .from("rubric_version")
    .select("id, version_label, title, effective_date, status, change_summary")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!version) return null;
  return hydrate(version as Omit<RubricVersion, "sections">);
}

/** A historical evaluation must render against the version it used, not the current one. */
export async function getRubricVersion(versionId: string): Promise<RubricVersion | null> {
  const { data: version, error } = await supabase
    .from("rubric_version")
    .select("id, version_label, title, effective_date, status, change_summary")
    .eq("id", versionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!version) return null;
  return hydrate(version as Omit<RubricVersion, "sections">);
}

async function hydrate(version: Omit<RubricVersion, "sections">): Promise<RubricVersion> {
  const [{ data: sections }, { data: criteria }] = await Promise.all([
    supabase
      .from("rubric_section")
      .select("id, code, title, kind, description, sort_order")
      .eq("version_id", version.id)
      .order("sort_order"),
    supabase
      .from("rubric_criterion")
      .select("id, code, stage, label, statement, guidance, na_condition, sort_order, section_id")
      .eq("version_id", version.id)
      .order("sort_order"),
  ]);

  return {
    ...version,
    sections: (sections ?? []).map((s) => ({
      ...(s as Omit<RubricSection, "criteria">),
      criteria: (criteria ?? []).filter(
        (c) => (c as Criterion).section_id === (s as RubricSection).id,
      ) as Criterion[],
    })),
  };
}

/**
 * Finds this evaluator's draft for a call, or starts one.
 *
 * Deliberately per-evaluator: two analysts scoring the same call each get their
 * own sheet rather than overwriting one another, which is also what makes
 * calibration possible later without a schema change.
 */
export async function openEvaluation(
  callId: string,
  orgId: string,
  personId: string,
): Promise<{ evaluation: Evaluation; rubric: RubricVersion }> {
  const { data: existing } = await supabase
    .from("evaluation")
    .select("*")
    .eq("call_id", callId)
    .eq("evaluator_id", personId)
    .eq("status", "draft")
    .maybeSingle<Evaluation>();

  if (existing) {
    const rubric = await getRubricVersion(existing.rubric_version_id);
    if (!rubric) throw new Error("The rubric used by this evaluation is missing.");
    return { evaluation: existing, rubric };
  }

  const rubric = await getActiveRubric();
  if (!rubric) {
    throw new Error(
      "No active rubric. An administrator needs to activate one before calls can be evaluated.",
    );
  }

  const { data: created, error } = await supabase
    .from("evaluation")
    .insert({
      org_id: orgId,
      call_id: callId,
      rubric_version_id: rubric.id,
      evaluator_id: personId,
      status: "draft",
    })
    .select("*")
    .single<Evaluation>();

  if (error) throw new Error(error.message);
  return { evaluation: created, rubric };
}

export async function getScores(evaluationId: string): Promise<ScoreRow[]> {
  const { data, error } = await supabase
    .from("evaluation_score")
    .select("criterion_id, value, raw_value, remark")
    .eq("evaluation_id", evaluationId);
  if (error) throw new Error(error.message);
  return (data ?? []) as ScoreRow[];
}

/** Autosave. Totals are recomputed by the database, not here. */
export async function saveScore(
  evaluationId: string,
  criterionId: string,
  value: ScoreValue | null,
  remark: string,
): Promise<void> {
  const { error } = await supabase
    .from("evaluation_score")
    .upsert(
      { evaluation_id: evaluationId, criterion_id: criterionId, value, remark },
      { onConflict: "evaluation_id,criterion_id" },
    );
  if (error) throw new Error(error.message);
}

export async function updateEvaluation(
  evaluationId: string,
  patch: Partial<
    Pick<Evaluation, "author_end_state" | "is_high_risk" | "summary_note" | "escalation_note">
  >,
): Promise<void> {
  const { error } = await supabase.from("evaluation").update(patch).eq("id", evaluationId);
  if (error) throw new Error(error.message);
}

export async function refreshEvaluation(evaluationId: string): Promise<Evaluation | null> {
  const { data } = await supabase
    .from("evaluation")
    .select("*")
    .eq("id", evaluationId)
    .maybeSingle<Evaluation>();
  return data;
}

export async function submitEvaluation(evaluationId: string): Promise<void> {
  const { error } = await supabase
    .from("evaluation")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", evaluationId);
  if (error) throw new Error(error.message);
}

export async function listEvaluations(callId: string): Promise<Evaluation[]> {
  const { data } = await supabase
    .from("evaluation")
    .select("*")
    .eq("call_id", callId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Evaluation[];
}

// ---- two-stage workflow --------------------------------------------------

export type EvaluationKind = "raw_observation" | "calibrated";

export interface QueueItem {
  assignment_id: string;
  status: string;
  queued_at: string;
  raw_evaluation_id: string;
  call_id: string;
  call_title: string;
  agent_name: string;
  reviewer_name: string | null;
  submitted_at: string;
  is_high_risk: boolean;
  escalation_note: string;
  no_count: number;
  yes_count: number;
  na_count: number;
  days_waiting: number;
  duration_ms: number | null;
  calibrated_evaluation_id: string | null;
}

/** Which workspace a person belongs in, from their permissions. */
export function workspaceFor(permissions: string[]): "calibration" | "raw" | "none" {
  if (permissions.includes("calibration.perform")) return "calibration";
  if (permissions.includes("raw_qa.submit")) return "raw";
  return "none";
}

export async function openRawSubmission(
  callId: string,
  orgId: string,
  personId: string,
): Promise<{ evaluation: Evaluation; rubric: RubricVersion }> {
  const { data: existing } = await supabase
    .from("evaluation")
    .select("*")
    .eq("call_id", callId)
    .eq("evaluator_id", personId)
    .eq("kind", "raw_observation")
    .eq("status", "draft")
    .maybeSingle<Evaluation>();

  if (existing) {
    const rubric = await getRubricVersion(existing.rubric_version_id);
    if (!rubric) throw new Error("The rubric for this submission is missing.");
    return { evaluation: existing, rubric };
  }

  const rubric = await getActiveRubric();
  if (!rubric) throw new Error("No active rubric. An administrator needs to activate one.");

  const { data: created, error } = await supabase
    .from("evaluation")
    .insert({
      org_id: orgId,
      call_id: callId,
      rubric_version_id: rubric.id,
      evaluator_id: personId,
      kind: "raw_observation",
      status: "draft",
    })
    .select("*")
    .single<Evaluation>();

  if (error) throw new Error(error.message);
  return { evaluation: created, rubric };
}

export async function getQueue(): Promise<QueueItem[]> {
  const { data, error } = await supabase
    .from("v_calibration_queue")
    .select("*")
    .order("queued_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as QueueItem[];
}

/**
 * Creates the calibrated evaluation, pre-filled from the raw submission.
 * All carry-forward happens in the database so the trainer's screen is never
 * assembled client-side and can never partially copy.
 */
export async function startCalibration(rawEvaluationId: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_calibration", {
    p_raw_id: rawEvaluationId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getEvaluationById(id: string): Promise<Evaluation | null> {
  const { data } = await supabase.from("evaluation").select("*").eq("id", id).maybeSingle<Evaluation>();
  return data;
}
