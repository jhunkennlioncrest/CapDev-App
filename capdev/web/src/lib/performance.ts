import { supabase } from "./supabase";
import { assessmentScoreMean } from "@/lib/dashboard";
import { periodRange, type Period } from "@/lib/period";

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
/**
 * Five states, and the distinction between the last two is the whole point.
 *
 * "none" is no calibrated evaluation at all — an em dash, because there is
 * nothing to say. "baseline" is exactly one: a first point under the active
 * rubric, with no earlier score to compare it against. Neither is a measured
 * direction, and neither may be called Stable.
 *
 * "flat" is a MEASUREMENT — two real scores, compared, within the band — and it
 * is the only one of the five that asserts nothing changed. Collapsing
 * "baseline" into it, as this code did until now, told the reader that a
 * representative with a single evaluation had held steady. Nothing had been
 * observed to hold. Direction is reported here; whether the score itself is
 * good or bad is not this function's business and never becomes one.
 */
export type TrendDirection = "up" | "down" | "flat" | "baseline" | "none";

/** One calibrated evaluation, as the trend reads it. */
export interface TrendPoint {
  submitted_at: string;
  overall_score: number | null;
}

/**
 * A representative's calibrated performance over time.
 *
 * Every field here is SHOWN in the roster, and that is the point: `previous`
 * and `current` are the exact two numbers `direction` was decided from, so the
 * claim can be checked against the table rather than taken on faith.
 */
export interface RepTrend {
  /** The calibrated evaluation immediately before the most recent one. */
  previous: number | null;
  /** The most recent submitted calibrated evaluation. */
  current: number | null;
  /** current − previous, in percentage points. Null unless both exist. */
  delta: number | null;
  /**
   * There is no separate `baseline` flag beside this. There used to be, and it
   * was a second source of truth for the same fact: `direction` said "flat"
   * while the boolean said "actually, one evaluation". Anything that read one
   * and not the other printed Stable. The state now has a name of its own.
   */
  direction: TrendDirection;
}

export const TREND_BAND = 1;

/**
 * Trend from a representative's calibrated history.
 *
 * THE SCORE. `overall_score` on a calibrated evaluation is set by
 * recompute_evaluation() as round(yes / (yes + no) * 100, 2) — criteria met
 * over criteria assessed, N/A excluded. That is the same definition as the
 * Trainer column, which pools the same counts across a representative's
 * evaluations instead of taking one. So previous, current and Trainer are the
 * same kind of number on the same scale, and comparing two of them is
 * meaningful. Raw observations are given overall_score = null by that same
 * function, so a Raw QA figure cannot reach this calculation even by accident.
 *
 * WHAT REPLACED WHAT. The previous model compared the mean of the earliest
 * third of a rep's evaluations against the mean of the latest third, and
 * refused to answer below six. It was defensible and completely unauditable
 * from the screen: the roster showed a direction and never the numbers behind
 * it. This compares the two most recent calibrated evaluations, and the roster
 * prints both.
 *
 * Ordering is by submitted_at, newest first, with the evaluation id as a
 * tiebreaker so two submissions in the same instant cannot swap places between
 * reads. Rows with a null score are not usable and are skipped rather than
 * treated as zero.
 */
export function calibratedTrend(points: TrendPoint[]): RepTrend {
  const usable = points
    .filter((p) => p.overall_score !== null)
    .slice()
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));

  const current = usable[0]?.overall_score ?? null;
  const previous = usable[1]?.overall_score ?? null;

  // Nothing calibrated: an em dash, not a direction.
  if (current === null) {
    return { previous: null, current: null, delta: null, direction: "none" };
  }

  // Exactly one: a baseline, not a trend. There is no earlier score, so no
  // direction was measured and none is named — delta stays null so nothing
  // downstream can print a change that was never observed. Explicitly NOT
  // "flat": flat means two scores were compared and did not move.
  if (previous === null) {
    return { previous: null, current, delta: null, direction: "baseline" };
  }

  const delta = Math.round((current - previous) * 10) / 10;
  return {
    previous,
    current,
    delta,
    direction: delta > TREND_BAND ? "up" : delta < -TREND_BAND ? "down" : "flat",
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
  /**
   * The criterion ROW's id, and the grouping key.
   *
   * Not the code, and not the label. Criteria are cloned per rubric version by
   * copy_rubric_version(), so v2.0's "S1.1" is a different row from v1.0's
   * "S1.1" — same code, possibly a different question. Grouping by id keeps
   * them apart without anyone having to decide whether they are "the same
   * criterion", which is a judgement the schema does not support making.
   */
  criterion_id: string;
  criterion_code: string;
  criterion_label: string;
  /** Which rubric version this criterion row belongs to. */
  version_label: string | null;
  compared: number;
  disagreements: number;
  disagreement_rate: number;
}

export interface CalibrationHotspotResult {
  /** The top criteria by disagreement rate. Empty when nothing disagreed. */
  rows: CalibrationHotspot[];
  /**
   * Every criterion comparison in the period, across all criteria.
   *
   * Carried so the caller can tell "nothing was compared" from "plenty was
   * compared and nobody disagreed". An empty `rows` alone cannot.
   */
  comparisons: number;
  /** Distinct rubric versions present, so the caller knows when to say so. */
  versions: string[];
}

/** Rows per request. PostgREST's default is a cap, not a promise. */
const HOTSPOT_PAGE = 1000;
/** How many criteria the section lists. Unchanged from the view it replaces. */
const HOTSPOT_TOP = 5;

/**
 * Criteria the rubric is being read two ways on, INSIDE A PERIOD.
 *
 * WHY NOT v_calibration_hotspots. That view aggregates to (org, criterion)
 * with no date dimension at all — the same shape problem the representative
 * views have. It cannot answer "September", and an all-time answer taken from
 * it would also be one rubric version's answer, since it carries no version
 * either. It is no longer read by this application.
 *
 * THE SOURCE IS v_calibration_comparison, and that choice is deliberate: it
 * carries the SAME access predicate the hotspot view did —
 * can_see_all_calibration_accuracy(), i.e. has_permission('calibration.perform')
 * — plus a self-branch for a reviewer's own rows, and it is row-level, so it
 * can be filtered by the calibration's submitted_at. Nothing about who may see
 * criterion-level disagreement changes here, and the caller gates the read on
 * the same permission besides, so a reviewer's own rows are never quietly
 * promoted into a department list.
 *
 * Paged, never taken on trust: fifteen comparison rows per calibration means a
 * few dozen calibrations already exceed a default page, and a truncated read
 * does not error — it returns a disagreement rate computed from part of the
 * period and presents it as all of it.
 */
export async function calibrationHotspotsForPeriod(
  period: Period,
): Promise<CalibrationHotspotResult> {
  const range = periodRange(period);

  interface Bucket {
    code: string;
    label: string;
    versionId: string | null;
    compared: number;
    disagreements: number;
  }
  const byCriterion = new Map<string, Bucket>();
  let comparisons = 0;

  for (let from = 0; ; from += HOTSPOT_PAGE) {
    let q = supabase
      .from("v_calibration_comparison")
      .select("criterion_id, criterion_code, criterion_label, rubric_version_id, aligned");
    if (range) {
      q = q.gte("submitted_at", range.startIso).lt("submitted_at", range.endIso);
    }
    const { data, error } = await q
      .order("score_id", { ascending: true })
      .range(from, from + HOTSPOT_PAGE - 1);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as {
      criterion_id: string;
      criterion_code: string;
      criterion_label: string;
      rubric_version_id: string | null;
      aligned: boolean | null;
    }[];

    for (const r of rows) {
      comparisons += 1;
      const b = byCriterion.get(r.criterion_id) ?? {
        code: r.criterion_code,
        label: r.criterion_label,
        versionId: r.rubric_version_id,
        compared: 0,
        disagreements: 0,
      };
      b.compared += 1;
      // `aligned` is `variance = 'agreed'` in the view. Anything else — including
      // a null variance — is not an agreement, which is how the department
      // summary counts it too.
      if (r.aligned !== true) b.disagreements += 1;
      byCriterion.set(r.criterion_id, b);
    }

    if (rows.length < HOTSPOT_PAGE) break;
  }

  // Version labels, so two versions' identically-coded criteria can be told
  // apart on screen. One read of a table that holds one row per rubric version.
  const versionIds = [...new Set([...byCriterion.values()].map((b) => b.versionId).filter(Boolean))];
  const labels = new Map<string, string>();
  if (versionIds.length > 0) {
    const { data } = await supabase.from("rubric_version").select("id, version_label");
    for (const v of (data ?? []) as { id: string; version_label: string }[]) {
      labels.set(v.id, v.version_label);
    }
  }

  const rows: CalibrationHotspot[] = [...byCriterion.entries()]
    .filter(([, b]) => b.disagreements > 0)
    .map(([criterion_id, b]) => ({
      criterion_id,
      criterion_code: b.code,
      criterion_label: b.label,
      version_label: b.versionId ? labels.get(b.versionId) ?? null : null,
      compared: b.compared,
      disagreements: b.disagreements,
      disagreement_rate: (100 * b.disagreements) / b.compared,
    }))
    // Rate first, as the view ordered it. The two tiebreakers are new and
    // deliberate: with small samples several criteria share a rate exactly, and
    // the view's unbroken tie left their order to the planner — so the same
    // data could list a different five between two loads.
    .sort(
      (a, b) =>
        b.disagreement_rate - a.disagreement_rate ||
        b.disagreements - a.disagreements ||
        a.criterion_code.localeCompare(b.criterion_code),
    )
    .slice(0, HOTSPOT_TOP);

  const versions = [...new Set(rows.map((r) => r.version_label).filter((v): v is string => v !== null))].sort();
  return { rows, comparisons, versions };
}

/* -------------------------------------------------------------------------- */
/* 0077 — Raw QA performance per representative                                */
/* -------------------------------------------------------------------------- */

/**
 * The Raw QA counterpart to RepPerformance.
 *
 * A separate type over a separate view, for the same reason the views are
 * separate: Raw QA and QA Trainer are distinct scoring systems that are
 * comparable but never interchangeable. One shared type would make averaging
 * them a one-line mistake instead of a deliberate one.
 *
 * Carries no Trainer concepts — no non-negotiables, no reward, no high-risk
 * count. Those belong to the calibrated assessment.
 */
export interface RepRawObservationPerformance {
  representative_id: string;
  representative_name: string;
  department: string;
  employee_ref: string;
  status: string;
  is_inactive: boolean;
  rubric_version_id: string;
  version_label: string;
  is_current_rubric: boolean;
  observations: number;
  /** Pooled: criteria met ÷ criteria assessed, over submitted observations. */
  score: number | null;
  criteria_assessed: number;
  criteria_met: number;
  first_observed: string | null;
  last_observed: string | null;
}

/**
 * Raw QA performance for every representative, one row per rubric version.
 *
 * The rubric filter mirrors listRepPerformance exactly, including the null
 * branch: representatives with no submitted observation carry a null
 * rubric_version_id, and .eq() excludes nulls, so filtering by rubric alone
 * would drop the never-observed part of the roster.
 */
export async function listRepRawObservationPerformance(
  rubricVersionId?: string | null,
): Promise<RepRawObservationPerformance[]> {
  let q = supabase.from("v_rep_raw_observation_performance").select("*");
  if (rubricVersionId) {
    q = q.or(`rubric_version_id.eq.${rubricVersionId},rubric_version_id.is.null`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as RepRawObservationPerformance[];
}

/**
 * The difference between the two assessments, in PERCENTAGE POINTS.
 *
 * Points, not percent change: 88% against 82% is six points apart, and calling
 * that "7.3% higher" would describe a relationship between the two numbers
 * rather than the size of the disagreement.
 *
 * Returns null when either side is missing. A rep with one assessment has no
 * gap — substituting zero for the absent side would invent a disagreement, or
 * hide one, depending on which way it fell.
 */
export function scoreGap(raw: number | null, trainer: number | null): number | null {
  if (raw === null || trainer === null) return null;
  // TRAINER MINUS RAW QA. The direction is not arbitrary: the calibrated
  // assessment is the organisation's decision, so it is the thing the gap is
  // measured FROM. A positive gap means the Trainer scored the representative
  // HIGHER than Raw QA did; negative means lower.
  //
  // This used to be raw - trainer, which read backwards to everyone outside
  // the code: a rep the Trainer marked up showed a negative number. The
  // argument order still mirrors the columns on screen (Raw QA, then Trainer);
  // only the subtraction changed.
  return trainer - raw;
}

/**
 * One decimal at most, and never a manufactured one: 62 stays "62%", 100 stays
 * "100%", 28.57 becomes "28.6%".
 *
 * Every performance percentage on the Dashboard goes through here. It exists
 * because four of them did not: the roster printed Raw QA, Trainer, Previous
 * and Current straight from their sources, so a single calibrated evaluation
 * showed as "28.6%" in one column (the view rounds to one decimal) and
 * "28.57%" in the next (the stored score keeps two). Same number, two
 * appearances, and a reader has to wonder which one is the measurement.
 *
 * Rounds for DISPLAY only. Nothing upstream rounds on the way in.
 */
export function formatPercent(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 10) / 10}%`;
}

/**
 * A signed movement, one decimal at most, with an explicit sign and a real
 * minus sign (U+2212) rather than a hyphen.
 *
 * Zero prints as "0", never "+0" or "−0": no movement has no direction, and a
 * signed zero reads as a rounding artefact.
 */
function signedDelta(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  const suffix = unit === "" ? "" : ` ${unit}`;
  if (rounded === 0) return `0${suffix}`;
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}${suffix}`;
}

/** "+6 pts", "−4 pts", "0 pts", or an em dash. The sign is never implicit. */
export function formatGap(gap: number | null): string {
  return signedDelta(gap, "pts");
}

/**
 * PERCENTAGE-POINT movement, for month-on-month comparison of a percentage
 * (0078-B).
 *
 * Points, never percent. September 60% against August 50% is +10 POINTS, not
 * +20%: the second is the relative change and is a different, larger-sounding
 * number that answers a question nobody asked. Both would be defensible on
 * their own; only one can be printed beside a percentage without the reader
 * having to guess which was meant.
 *
 * Identical formatting to formatGap on purpose — the Raw QA/Trainer gap and a
 * month-on-month movement are both point movements, and two conventions for
 * one unit on one page is how a reader stops trusting either.
 */
export function formatPointDelta(delta: number | null): string {
  return signedDelta(delta, "pts");
}

/**
 * COUNT movement, for month-on-month comparison of a true count (0078-B).
 *
 * Absolute units, never percentage growth. Eighteen observations against
 * fourteen is "+4", not "+28.6%" — a percentage change on a base of fourteen
 * dramatises noise, and the reader can already see both months' counts.
 *
 * Counts are whole, so no decimal is ever produced here in practice; the shared
 * formatter's rounding is a safety net rather than a feature.
 */
export function formatCountDelta(delta: number | null): string {
  return signedDelta(delta, "");
}

/* -------------------------------------------------------------------------- */
/* Roster trends, in a bounded number of reads                                 */
/* -------------------------------------------------------------------------- */

/**
 * Calibrated trend for many representatives at once.
 *
 * Source: v_rep_evaluations, which is already exactly the right population —
 * its own WHERE is kind = 'calibrated' AND status = 'submitted' AND
 * archived_at IS NULL. Draft evaluations are excluded by that status test, and
 * so are superseded ones: supersede_evaluation() sets the old row's status to
 * 'superseded', it does not archive it. The active-rubric filter is applied
 * here on top.
 *
 * Only the newest rows are read. The answer needs two evaluations per
 * representative, so the sweep goes newest-first and stops as soon as every
 * representative asked about has two — not after the whole history.
 *
 * Two refusals, unchanged in spirit from the batching this replaces:
 *
 *   - A failed read returns an empty map. Every representative then falls to
 *     the caller's "no trend yet", and the rest of the roster still renders. A
 *     direction invented from a query that did not return would be a claim
 *     about a person's progress.
 *
 *   - If the sweep hits TREND_MAX_ROWS before the source is exhausted, the map
 *     is abandoned rather than returned half-filled. A partial sweep can leave
 *     a representative looking as though they have no history when they have
 *     plenty, and a confident blank is still a wrong answer.
 */
const TREND_ID_CHUNK = 100;
const TREND_PAGE = 500;
const TREND_MAX_ROWS = 20000;
const TREND_MAX_RESTARTS = 8;

export async function calibratedTrends(
  representativeIds: string[],
  rubricVersionId?: string | null,
): Promise<Record<string, RepTrend>> {
  const ids = [...new Set(representativeIds)].filter(Boolean);
  if (ids.length === 0) return {};

  const byRep = new Map<string, TrendPoint[]>();
  for (const id of ids) byRep.set(id, []);

  try {
    // Chunked so the `in` list cannot grow into an over-long request URL as the
    // representative population grows.
    for (let i = 0; i < ids.length; i += TREND_ID_CHUNK) {
      const chunk = ids.slice(i, i + TREND_ID_CHUNK);
      const need = new Set(chunk);
      let asked = chunk;          // the id list this pagination run is filtered by
      let from = 0;
      let restarts = 0;
      let rowsRead = 0;

      while (need.size > 0) {
        let q = supabase
          .from("v_rep_evaluations")
          .select("representative_id, submitted_at, overall_score, evaluation_id")
          .in("representative_id", asked);
        if (rubricVersionId) q = q.eq("rubric_version_id", rubricVersionId);

        const { data, error } = await q
          .order("submitted_at", { ascending: false })
          .order("evaluation_id", { ascending: false })
          .range(from, from + TREND_PAGE - 1);
        if (error) throw new Error(error.message);

        const rows = (data ?? []) as {
          representative_id: string;
          submitted_at: string;
          overall_score: number | null;
        }[];
        rowsRead += rows.length;

        const before = need.size;
        for (const r of rows) {
          const bucket = byRep.get(r.representative_id);
          if (!bucket) continue;
          // Two usable scores is the whole answer. Older rows are not kept.
          if (r.overall_score !== null && bucket.length < 2) {
            bucket.push({ submitted_at: r.submitted_at, overall_score: r.overall_score });
          }
          if (bucket.length >= 2) need.delete(r.representative_id);
        }

        if (rows.length < TREND_PAGE) break;   // source exhausted
        if (need.size === 0) break;

        // Someone was satisfied on this page. Start a fresh pagination over
        // just the representatives still wanted, so their rows are skipped
        // entirely rather than paged past.
        //
        // This matters more than it looks. The sweep is newest-first across the
        // WHOLE chunk, so one representative with a long recent history sits at
        // the front of every page and buries everyone else behind thousands of
        // rows that are already answered. Narrowing cannot be done by editing
        // the filter mid-run — a smaller result set would make `from` point
        // somewhere else entirely, and page two would skip precisely the rows
        // page two needs — so the run restarts at offset zero with the new
        // list. Restarts are capped: each one is another round trip, and the
        // point of this function is to not spend one per representative.
        if (need.size < before && restarts < TREND_MAX_RESTARTS) {
          asked = [...need];
          from = 0;
          restarts += 1;
          continue;
        }

        from += TREND_PAGE;
        if (rowsRead >= TREND_MAX_ROWS) return {};
      }
    }
  } catch {
    return {};
  }

  const out: Record<string, RepTrend> = {};
  for (const [id, points] of byRep) out[id] = calibratedTrend(points);
  return out;
}

/* -------------------------------------------------------------------------- */
/* 0078-A — representative performance for a period                            */
/* -------------------------------------------------------------------------- */

/**
 * One representative's assessments inside the selected month.
 *
 * WHY THIS EXISTS AT ALL, rather than a date filter on the views the Dashboard
 * already uses: v_rep_performance and v_rep_raw_observation_performance are
 * aggregated to one row per (representative x rubric version). They carry
 * min/max(submitted_at) and nothing else about time, so there is no month to
 * filter on — the aggregation has already happened. Adding a date dimension to
 * an aggregated view is a larger and riskier change than reading the rows the
 * views are built from, which is what this does.
 *
 * TWO READS FOR THE WHOLE ROSTER, not one per representative. The rows come
 * back for every representative at once and are grouped here.
 *
 * THE SCORES ARE MEANS, matching the headline cards. The all-time views expose
 * `score` as a POOLED ratio (sum yes / sum applicable); the monthly figures are
 * means of the individual assessment scores, computed with the very same
 * helper the Calibrated Score card uses. That is a deliberate change of meaning
 * for the monthly columns and is recorded as such.
 */
/**
 * One assessment of this representative inside the period (0079).
 *
 * Surfaced, not re-fetched: these are the very rows the four figures above were
 * computed from. A report that listed a separate read could show a history that
 * does not add up to the summary sitting above it.
 */
export interface RepPeriodAssessment {
  id: string;
  kind: string;
  submitted_at: string | null;
  yes_count: number | null;
  applicable_count: number | null;
  overall_score: number | null;
  non_negotiables_all_pass: boolean | null;
}

export interface RepPeriodRow {
  representative_id: string;
  representative_name: string;
  status: string;
  is_inactive: boolean;
  /** Submitted Raw QA observations of this representative's calls, in period. */
  observations: number;
  /** Submitted calibrated evaluations, in period. */
  evaluations: number;
  /** Mean of the individual Raw QA observation scores. */
  observedPct: number | null;
  /** Mean of the individual calibrated evaluation scores. */
  calibratedPct: number | null;
  /** The assessments behind the four figures above, newest first (0079). */
  assessments: RepPeriodAssessment[];
}

export interface RepPeriodResult {
  rows: RepPeriodRow[];
  /** Representatives on the roster with no assessment at all in the period. */
  withoutAssessments: number;
}

/** Rows per request. PostgREST's default is a cap, not a promise. */
const REP_PERIOD_PAGE = 1000;

interface PeriodAssessment {
  id: string;
  kind: string;
  /** 0079: carried so a report can list the assessments it counted. */
  submitted_at: string | null;
  yes_count: number | null;
  applicable_count: number | null;
  overall_score: number | null;
  /** 0079: carried so a per-representative Non-Negotiables rate needs no second read. */
  non_negotiables_all_pass: boolean | null;
  call: { representative_id: string | null } | { representative_id: string | null }[] | null;
}

/** PostgREST returns a many-to-one embed as an object; be tolerant anyway. */
function embeddedRepId(row: PeriodAssessment): string | null {
  const c = row.call;
  if (c === null || c === undefined) return null;
  if (Array.isArray(c)) return c[0]?.representative_id ?? null;
  return c.representative_id ?? null;
}

export async function repPerformanceForPeriod(period: Period): Promise<RepPeriodResult> {
  // Null for all time. ONE data model for both periods — per-evaluation rows,
  // grouped by representative, means computed — with only the boundary
  // changing. All time used to come from the aggregated views instead, which
  // are scoped to a rubric version and would have dropped older history the
  // moment a new rubric was activated.
  const range = periodRange(period);

  // The embed is from a TABLE with a real foreign key (evaluation.call_id ->
  // call.id), not from a view — the relationship PostgREST resolves is provable
  // rather than inferred, which is why 0077 refused the view-embed form.
  const assessments: PeriodAssessment[] = [];
  for (let from = 0; ; from += REP_PERIOD_PAGE) {
    let q = supabase
      .from("evaluation")
      // Two columns wider than 0078 and not one predicate different: a report
      // must list and sub-total the SAME rows these figures came from, and a
      // second query for them is how a history stops matching its summary.
      .select(
        "id, kind, submitted_at, yes_count, applicable_count, overall_score, " +
          "non_negotiables_all_pass, call!inner(representative_id)",
      )
      .in("kind", ["raw_observation", "calibrated"])
      .eq("status", "submitted")
      .is("archived_at", null);
    if (range) q = q.gte("submitted_at", range.startIso).lt("submitted_at", range.endIso);
    const { data, error } = await q
      .order("id", { ascending: true })
      .range(from, from + REP_PERIOD_PAGE - 1);
    // Thrown, never swallowed: a truncated or refused read must not be rendered
    // as a month in which nobody was assessed.
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as PeriodAssessment[];
    assessments.push(...rows);
    if (rows.length < REP_PERIOD_PAGE) break;
  }

  const directory = await listRepresentatives();
  const byId = new Map(directory.map((r) => [r.id, r]));

  const grouped = new Map<string, { raw: PeriodAssessment[]; cal: PeriodAssessment[] }>();
  for (const a of assessments) {
    const repId = embeddedRepId(a);
    // A call with no representative linked yet belongs to nobody's month. It is
    // not dropped from the department figures, which do not group by person.
    if (!repId) continue;
    const bucket = grouped.get(repId) ?? { raw: [], cal: [] };
    if (a.kind === "calibrated") bucket.cal.push(a);
    else bucket.raw.push(a);
    grouped.set(repId, bucket);
  }

  const rows: RepPeriodRow[] = [];
  for (const [repId, bucket] of grouped) {
    const person = byId.get(repId);
    rows.push({
      representative_id: repId,
      representative_name: person?.display_name ?? "Unknown representative",
      status: person?.status ?? "",
      is_inactive: person?.is_inactive ?? false,
      observations: bucket.raw.length,
      evaluations: bucket.cal.length,
      observedPct: assessmentScoreMean(bucket.raw),
      calibratedPct: assessmentScoreMean(bucket.cal),
      assessments: [...bucket.raw, ...bucket.cal]
        .map((a) => ({
          id: a.id,
          kind: a.kind,
          submitted_at: a.submitted_at,
          yes_count: a.yes_count,
          applicable_count: a.applicable_count,
          overall_score: a.overall_score,
          non_negotiables_all_pass: a.non_negotiables_all_pass,
        }))
        // Newest first: a history is read from the most recent backwards.
        .sort((x, y) => (y.submitted_at ?? "").localeCompare(x.submitted_at ?? "")),
    });
  }
  rows.sort((a, b) => a.representative_name.localeCompare(b.representative_name));

  // Stated, not implied by an absence: a reader needs to know the table is
  // short because nobody was assessed, not because the read failed.
  const withoutAssessments = directory.filter(
    (r) => !r.is_inactive && !grouped.has(r.id),
  ).length;

  return { rows, withoutAssessments };
}
