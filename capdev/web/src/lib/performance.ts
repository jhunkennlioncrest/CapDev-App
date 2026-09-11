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
export type TrendDirection = "up" | "down" | "flat" | "unknown";

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

  if (current === null || previous === null) {
    return { previous, current, delta: null, direction: "unknown" };
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
  return raw - trainer;
}

/** "+6 pts", "-4 pts", "0 pts", or an em dash. The sign is never implicit. */
export function formatGap(gap: number | null): string {
  if (gap === null) return "—";
  const rounded = Math.round(gap * 10) / 10;
  if (rounded === 0) return "0 pts";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} pts`;
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
