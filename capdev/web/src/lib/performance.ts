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
  employee_ref: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  /** Derived from the parts as "First Last". Never typed directly. */
  display_name: string;
  department: string;
  status: string;
  has_login: boolean;
  is_inactive: boolean;
  calls: number;
  completed_evaluations: number;
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

  // Representatives with no completed calibration carry a null
  // rubric_version_id, and .eq() excludes nulls — so filtering by rubric alone
  // would drop the whole never-evaluated part of the roster, which is exactly
  // the group Administration lists and this screen was missing.
  //
  // .or() keeps the rubric filter intact for everyone who has been evaluated
  // and lets the roster rows through alongside them.
  if (rubricVersionId) {
    q = q.or(`rubric_version_id.eq.${rubricVersionId},rubric_version_id.is.null`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  // Sorted here rather than in the query: "evaluated first by score, then
  // never-evaluated alphabetically" is two orderings over different columns,
  // and PostgREST cannot express the second without nulls-last guesswork.
  return (data ?? []).sort((a, b) => {
    const aEmpty = a.evaluations === 0;
    const bEmpty = b.evaluations === 0;
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    if (aEmpty) return a.representative_name.localeCompare(b.representative_name);
    return (b.score ?? 0) - (a.score ?? 0);
  }) as RepPerformance[];
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

/** The canonical directory. The one place representative names come from. */
export async function listRepresentatives(): Promise<Representative[]> {
  const { data, error } = await supabase
    .from("v_representative_directory")
    .select("*")
    .order("display_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Representative[];
}

export async function addRepresentative(params: {
  firstName: string;
  middleName?: string;
  lastName: string;
  department?: string;
  employeeRef?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("add_representative", {
    p_display_name: null,
    p_department: params.department ?? "",
    p_employee_ref: params.employeeRef ?? "",
    p_email: null,
    p_first_name: params.firstName,
    p_middle_name: params.middleName ?? "",
    p_last_name: params.lastName,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function updateRepresentative(
  id: string,
  patch: {
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    department?: string;
    employee_ref?: string;
    status?: string;
  },
): Promise<void> {
  const { error } = await supabase.from("person").update(patch).eq("id", id);
  if (error) {
    if (error.message.includes("person_employee_ref_key")) {
      throw new Error("That employee reference is already in use.");
    }
    throw new Error(error.message);
  }
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


// ---------------------------------------------------------------------------
// Department-first selection
//
// With ninety representatives, one flat list is unusable. Department narrows
// it to a handful before anyone has to read a name.

export interface Department {
  department: string;
  active_representatives: number;
  total_representatives: number;
}

/**
 * Departments that actually have representatives.
 *
 * Derived from the directory rather than declared: a department exists because
 * someone works in it, so there is nothing separate to maintain.
 */
export async function listDepartments(): Promise<Department[]> {
  const { data, error } = await supabase
    .from("v_departments")
    .select("*")
    .order("department");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Department[]).filter((d) => d.active_representatives > 0);
}

/** Active representatives in one department, for the upload selector. */
export async function representativesIn(department: string): Promise<Representative[]> {
  const { data, error } = await supabase
    .from("v_representative_directory")
    .select("*")
    .eq("department", department)
    .eq("is_inactive", false)
    .order("display_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Representative[];
}


// ---------------------------------------------------------------------------
// Calibration accuracy
//
// A THIRD metric, and the one most easily confused with the other two. It says
// how often a reviewer's observation matched the trainer's final decision. It
// is not the representative's score and never appears as one.

export interface CalibrationAccuracy {
  reviewer_id: string;
  reviewer_name: string;
  compared: number;
  aligned: number;
  disagreements: number;
  /** Null when nothing has been calibrated yet — never 0, which would read as bad work. */
  accuracy: number | null;
  calibrations: number;
  last_calibrated_at: string | null;
}

export interface CalibrationComparison {
  criterion_code: string;
  criterion_label: string;
  raw_value: string;
  trainer_value: string;
  trainer_justification: string;
  variance: string;
  aligned: boolean;
  call_id: string;
  call_title: string;
  submitted_at: string;
}

/**
 * Accuracy for everyone the caller is permitted to see.
 *
 * No reviewer filter is passed: the view itself returns a reviewer only their
 * own row, and returns every reviewer to anyone with calibration.perform.
 * Filtering here as well would be decoration — the guarantee has to live where
 * a direct query cannot bypass it.
 */
export async function calibrationAccuracy(): Promise<CalibrationAccuracy[]> {
  const { data, error } = await supabase
    .from("v_calibration_accuracy")
    .select("*")
    .order("accuracy", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CalibrationAccuracy[];
}

/** The disagreements themselves — developmental feedback, not a verdict. */
export async function calibrationDisagreements(
  reviewerId: string,
): Promise<CalibrationComparison[]> {
  const { data, error } = await supabase
    .from("v_calibration_comparison")
    .select("*")
    // Scoped again by the view; this narrows a supervisor's list to one person.
    .eq("reviewer_id", reviewerId)
    .eq("aligned", false)
    .order("submitted_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as CalibrationComparison[];
}

export interface CalibrationHotspot {
  criterion_code: string;
  criterion_label: string;
  compared: number;
  disagreements: number;
  disagreement_rate: number;
}

/** Criteria the rubric is being read two ways on. */
export async function calibrationHotspots(): Promise<CalibrationHotspot[]> {
  const { data, error } = await supabase
    .from("v_calibration_hotspots")
    .select("*")
    .order("disagreement_rate", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []) as CalibrationHotspot[];
}
