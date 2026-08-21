import { supabase } from "./supabase";

/**
 * Representative performance.
 *
 * Built only from completed, calibrated evaluations. A raw observation is a
 * reviewer's reading of a call; the calibration is the organisation's
 * decision. Only the second is anyone's official record.
 */

export interface RepPerformance {
  representative_id: string;
  representative_name: string;
  department: string;
  employee_ref: string;
  status: string;
  is_inactive: boolean;
  rubric_version_id: string;
  version_label: string;
  is_current_rubric: boolean;
  evaluations: number;
  /** Pooled: criteria met ÷ criteria assessed. The headline. */
  score: number | null;
  /** Mean of per-evaluation percentages. Published for comparison. */
  mean_of_evaluations: number | null;
  criteria_assessed: number;
  criteria_met: number;
  non_negotiables_clean: number;
  high_risk_calls: number;
  rewarded: number;
  first_evaluated: string | null;
  last_evaluated: string | null;
}

export interface RepEvaluation {
  evaluation_id: string;
  call_id: string;
  call_title: string;
  submitted_at: string;
  overall_score: number | null;
  yes_count: number;
  no_count: number;
  na_count: number;
  applicable_count: number;
  non_negotiables_all_pass: boolean | null;
  is_high_risk: boolean;
  reward_tier: string | null;
  version_label: string;
  rubric_version_id: string;
  calibrated_by: string | null;
  observed_by: string | null;
  reviewer_score: number | null;
  changed_criteria: number;
}

export interface CriterionPerformance {
  criterion_id: string;
  code: string;
  label: string;
  statement: string;
  section_title: string;
  section_kind: "checklist" | "non_negotiable";
  sort_order: number;
  times_applicable: number;
  times_met: number;
  times_not_applicable: number;
  met_rate: number | null;
}

export interface VarianceRow {
  code: string;
  label: string;
  section_title: string;
  variances: number;
  missed_failures: number;
  false_failures: number;
  compared: number;
}

export interface Representative {
  id: string;
  display_name: string;
  department: string;
  employee_ref: string;
  status: string;
  is_representative: boolean;
  has_login: boolean;
  archived_at: string | null;
}

/**
 * Performance for every representative, one row per rubric version.
 *
 * Never collapsed across versions: two versions may ask different questions,
 * and a single averaged figure would quietly assert they are the same test.
 */
export async function listRepPerformance(
  rubricVersionId?: string | null,
): Promise<RepPerformance[]> {
  let q = supabase.from("v_rep_performance").select("*");
  if (rubricVersionId) q = q.eq("rubric_version_id", rubricVersionId);
  const { data, error } = await q.order("score", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RepPerformance[];
}

export async function repEvaluations(
  representativeId: string,
  rubricVersionId?: string | null,
): Promise<RepEvaluation[]> {
  let q = supabase
    .from("v_rep_evaluations")
    .select("*")
    .eq("representative_id", representativeId);
  if (rubricVersionId) q = q.eq("rubric_version_id", rubricVersionId);
  const { data, error } = await q.order("submitted_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RepEvaluation[];
}

export async function repCriteria(
  representativeId: string,
  rubricVersionId: string,
): Promise<CriterionPerformance[]> {
  const { data, error } = await supabase
    .from("v_rep_criterion_performance")
    .select("*")
    .eq("representative_id", representativeId)
    .eq("rubric_version_id", rubricVersionId)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as CriterionPerformance[];
}

export async function repVariance(
  representativeId: string,
  rubricVersionId: string,
): Promise<VarianceRow[]> {
  const { data, error } = await supabase
    .from("v_rep_calibration_variance")
    .select("*")
    .eq("representative_id", representativeId)
    .eq("rubric_version_id", rubricVersionId)
    .gt("variances", 0)
    .order("variances", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as VarianceRow[];
}

// ---- representatives as records ------------------------------------------

export async function listRepresentatives(): Promise<Representative[]> {
  const { data, error } = await supabase
    .from("person")
    .select("id, display_name, department, employee_ref, status, is_representative, auth_user_id, archived_at")
    .eq("is_representative", true)
    .order("display_name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as (Omit<Representative, "has_login"> & { auth_user_id: string | null })[]).map(
    (r) => ({ ...r, has_login: r.auth_user_id !== null }),
  );
}

export async function addRepresentative(params: {
  displayName: string;
  department?: string;
  employeeRef?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("add_representative", {
    p_display_name: params.displayName,
    p_department: params.department ?? "",
    p_employee_ref: params.employeeRef ?? "",
    p_email: null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function updateRepresentative(
  id: string,
  patch: { display_name?: string; department?: string; employee_ref?: string; status?: string },
): Promise<void> {
  const { error } = await supabase.from("person").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Links a call to its representative. */
export async function setCallRepresentative(
  callId: string,
  representativeId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("call")
    .update({ representative_id: representativeId })
    .eq("id", callId);
  if (error) throw new Error(error.message);
}

/** Calls with no canonical representative — work that counts for nobody. */
export async function unlinkedCalls(): Promise<
  { call_id: string; title: string; agent_name: string | null; completed_evaluations: number }[]
> {
  const { data } = await supabase
    .from("v_unlinked_calls")
    .select("call_id, title, agent_name, completed_evaluations")
    .order("created_at", { ascending: false });
  return (data ?? []) as {
    call_id: string;
    title: string;
    agent_name: string | null;
    completed_evaluations: number;
  }[];
}

/**
 * Direction of travel across a rep's evaluations under one rubric version.
 *
 * Compares the most recent third against the earliest third, and refuses to
 * report anything below six evaluations — with fewer, a single call moves the
 * figure more than any real change in performance would.
 */
export function trendFrom(evaluations: RepEvaluation[]): {
  direction: "up" | "down" | "flat" | "unknown";
  delta: number | null;
  basis: string;
} {
  const scored = evaluations
    .filter((e) => e.overall_score !== null)
    .slice()
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));

  if (scored.length < 6) {
    return {
      direction: "unknown",
      delta: null,
      basis: `${scored.length} evaluation${scored.length === 1 ? "" : "s"} — too few to read a trend`,
    };
  }

  const size = Math.floor(scored.length / 3);
  const mean = (rows: RepEvaluation[]): number =>
    rows.reduce((sum, r) => sum + (r.overall_score ?? 0), 0) / rows.length;

  const earliest = mean(scored.slice(0, size));
  const latest = mean(scored.slice(-size));
  const delta = Math.round((latest - earliest) * 10) / 10;

  return {
    direction: delta > 1 ? "up" : delta < -1 ? "down" : "flat",
    delta,
    basis: `first ${size} vs last ${size} of ${scored.length}`,
  };
}
