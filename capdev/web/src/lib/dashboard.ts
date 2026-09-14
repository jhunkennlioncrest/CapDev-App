import { supabase } from "@/lib/supabase";
import {
  currentMonthPeriod,
  monthsInSpan,
  periodKey,
  periodRange,
  previousMonthPeriod,
  type Period,
} from "@/lib/period";

/**
 * Dashboard figures, scoped to the role that is looking.
 *
 * A presentation layer only: every number here comes from a system that
 * already owns it. No score is recalculated, no alignment is recomputed, no
 * risk is counted outside the register.
 *
 * The rule each figure must satisfy: what is measured, whose it is, and over
 * what period. A number that cannot answer all three does not belong here —
 * which is why the old org-wide "average score" was removed from the reviewer.
 */

/* -------------------------------------------------------------------------- */
/* Personal activity, in the selected period (0078-A)                          */
/* -------------------------------------------------------------------------- */

/**
 * Both personal counts used to be "since Monday", measured from the BROWSER's
 * local midnight. 0078 changes both halves of that.
 *
 * THE PERIOD IS THE SELECTED ONE, so the whole page speaks one period language.
 * "Calibrations this week" sitting above a September department score invited
 * the two numbers to be read together, and they could not be — one covered
 * seven days, the other thirty.
 *
 * THE BOUNDARY IS THE BUSINESS ZONE'S, not the reader's (lib/period.ts). A
 * trainer in Manila and a manager in London must count the same calibrations
 * into the same month.
 *
 * Archived assessments are now excluded, which "since Monday" did not do. The
 * department sets R and C have always excluded them; a personal count that
 * included them could exceed the department count it sits above.
 */
export interface ActivityFigures {
  /** Assessments this person submitted inside the selected period. */
  submitted: number;
}

async function personalCount(
  personId: string,
  kind: "raw_observation" | "calibrated",
  period: Period,
): Promise<ActivityFigures> {
  let q = supabase
    .from("evaluation")
    .select("id", { count: "exact", head: true })
    .eq("evaluator_id", personId)
    .eq("kind", kind)
    .eq("status", "submitted")
    .is("archived_at", null);

  const range = periodRange(period);
  if (range) {
    // Half-open. `lt`, never `lte` — see lib/period.ts.
    q = q.gte("submitted_at", range.startIso).lt("submitted_at", range.endIso);
  }

  const { count } = await q;
  return { submitted: count ?? 0 };
}

/** The reviewer's own submitted observations in the selected period. */
export async function reviewerFigures(
  personId: string,
  period: Period,
): Promise<ActivityFigures> {
  return personalCount(personId, "raw_observation", period);
}

/** The trainer's own submitted calibrations in the selected period. */
export async function trainerFigures(
  personId: string,
  period: Period,
): Promise<ActivityFigures> {
  return personalCount(personId, "calibrated", period);
}

/* -------------------------------------------------------------------------- */
/* 0077 — shared performance                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The department's performance, identical for every role that can see it.
 *
 * These figures break the personal-dashboard rule above on purpose, and the
 * rule survives: the figures at the top of this file answer "whose work is
 * this", because they are one person's queue. These answer a different
 * question — how is the department doing against the rubric — so instead of an
 * owner they carry a scope, stated in the heading and never implied: ALL TIME,
 * CURRENT ACTIVE RUBRIC. A figure still has to say what it covers; it does not
 * have to belong to somebody.
 *
 * Visibility is `evaluation.read`. That is not a new boundary invented for the
 * Dashboard — it is the RLS predicate already guarding every table underneath,
 * so the UI gate and the database agree by construction rather than by
 * maintenance. Every QA-facing role holds it, which is the point: Raw QA seeing
 * Trainer stage performance is the transparency this section exists for.
 * Seeing a number grants no authority to change one.
 */
export interface StageFigure {
  key: string;
  label: string;
  /**
   * Criteria met within the stage: 100 * yes / (yes + no), pooled across every
   * qualifying evaluation. Null when the stage has no applicable criterion
   * anywhere — which is not the same as 0%, and must never render as one.
   */
  pct: number | null;
  /**
   * Contributing EVALUATIONS — those with at least one applicable criterion in
   * this stage. NOT criterion rows: the two units are a factor of several
   * apart, and confusing them would retire the limited-data caution exactly
   * where it is most needed.
   */
  n: number;
  /** Criteria answered Yes, pooled. A CRITERION count, not an evaluation one. */
  met: number;
  /** Criteria answered No, pooled. */
  missed: number;
  /**
   * Criteria marked N/A, pooled. Carried so the card can distinguish three
   * states a single percentage cannot: nothing recorded at all, criteria
   * recorded but none applicable, and a real measured ratio.
   */
  na: number;
  /**
   * Evaluations that touched this stage at all, applicable or not. Equals `n`
   * unless some evaluation answered every criterion in the stage N/A.
   */
  touched: number;
}

export interface SharedPerformance {
  rubricVersionId: string | null;
  rubricLabel: string | null;
  observedCount: number;
  evaluatedCount: number;
  /** Mean of the individual submitted Raw QA observation scores. */
  observedPct: number | null;
  /** Mean of the individual submitted calibrated evaluation scores. */
  evaluatedPct: number | null;
  /**
   * null means the figure could not be read, NOT that it is zero. The two are
   * indistinguishable under RLS, and rendering an unreadable figure as 0%
   * would claim perfect alignment where the truth is "you cannot see this".
   */
  /**
   * THREE STATES, and they must not collapse into each other.
   *
   *   null                       — you cannot see this. Not zero.
   *   { pct: null, comparisons: 0 } — nothing was compared. A percentage with
   *                                no denominator is undefined, not 0%.
   *   { pct: 0, comparisons: 60 }  — a real, measured zero: sixty comparisons
   *                                and not one disagreement.
   *
   * The middle case used to render as "0%", which claimed perfect alignment
   * for a month in which nobody calibrated anything.
   */
  disagreements: { pct: number | null; comparisons: number; misaligned: number } | null;
  stages: StageFigure[];
  /**
   * Stage performance split by rubric version.
   *
   * Non-null ONLY when the selected period contains assessments from more than
   * one rubric version. Two versions' "Opening" are not necessarily the same
   * question — the criteria behind the name can differ — so pooling them into
   * one percentage would assert an equivalence nobody established. When this is
   * present the caller renders these blocks and ignores `stages`.
   */
  stageGroups: StageGroup[] | null;
  nonNegotiables: { pct: number; n: number; passed: number } | null;
  /**
   * Every rubric version represented by the assessments in this period, in
   * label order. Disclosed on screen always — including when there is only one
   * — so that its appearance is never itself the signal that something unusual
   * happened.
   */
  rubricLabels: string[];
  /**
   * The rubric versions of the CALIBRATED evaluations in this period, by id
   * (0078-B).
   *
   * Ids, not labels: a label is a human string that two versions could in
   * principle share, and the question this answers — "were these two months
   * measured with the same instrument" — has to be decided on identity.
   *
   * Raw observations are excluded because Stage Performance is calibrated-only,
   * and this exists to gate the stage comparison.
   */
  calibratedVersionIds: string[];
}

export interface StageGroup {
  versionId: string;
  versionLabel: string;
  /** Calibrated evaluations of this version inside the period. */
  evaluations: number;
  stages: StageFigure[];
}

/**
 * The five conversation stages, in rubric order, with the labels the business
 * uses. The KEYS are the canonical stage keys emitted by
 * v_stage_checklist_status, which is where the rubric's own stage text
 * ("Opening", "Discovery Call", "Collaborative Problem-Solving", "Timeline
 * Transparency", "Closing") is mapped. The mapping lives in the database, once;
 * nothing here infers a stage from a label.
 */
const STAGES: { key: string; label: string }[] = [
  { key: "opening", label: "Opening" },
  { key: "problem_discovery", label: "Discovery Call" },
  { key: "collaborative_problem_solving", label: "Collaborative Problem Solving" },
  { key: "timeline_transparency", label: "Timeline Transparency" },
  { key: "professional_closing", label: "Closing" },
];

/** Below this a percentage is reported with a caution rather than alone. */
export const LOW_SAMPLE = 5;

/**
 * The pooled criteria-met ratio: sum(yes) over sum(applicable), across a set of
 * assessments.
 *
 * NOT used by any Dashboard card, deliberately. Observed Score and Calibrated
 * Score were both this until the follow-up pass and are now means of the
 * individual assessment scores instead, so that the two cards sitting side by
 * side can honestly be subtracted from each other.
 *
 * Kept because the measure itself is legitimate — it answers "of every
 * applicable criterion the department assessed, how many were met", which is a
 * real question, just a different one. If it comes back it comes back under its
 * own name, "Criteria Met Rate", on its own card. Re-deriving it later from a
 * commit message would be worse than leaving it here, named and explained.
 */
export function criteriaMetRate(
  rows: { yes_count: number | null; applicable_count: number | null }[] | null,
): number | null {
  const yes = (rows ?? []).reduce((a, r) => a + (r.yes_count ?? 0), 0);
  const app = (rows ?? []).reduce((a, r) => a + (r.applicable_count ?? 0), 0);
  return app > 0 ? (100 * yes) / app : null;
}

/**
 * Stage performance, read from the CALIBRATED RUBRIC CRITERIA.
 *
 * WHAT THIS IS NOT. It is not the QA Trainer's 0-5 stage judgement. That
 * system — evaluation_stage_score, saveStageScore(), v_trainer_score,
 * v_trainer_determination, v_trainer_reward — is a separate, manual, holistic
 * assessment and is untouched by this module. It remains the basis for
 * coaching, trainer determination and reward. It is simply not what the
 * Dashboard means by "Stage performance", and reading it here made the section
 * blank whenever a Trainer had not hand-scored a call, which is most of them.
 *
 * WHAT IT IS. For each of the five conversation stages: the checklist criteria
 * belonging to that stage, across every submitted calibrated evaluation on the
 * ACTIVE rubric, pooled.
 *
 *     stage % = 100 * sum(yes) / sum(yes + no)
 *
 * Pooled over the underlying criterion results — never an average of rounded
 * per-evaluation or per-representative percentages, which would weight a call
 * with one applicable criterion the same as one with five.
 *
 * N/A IS NOT A MISS. It is a question that did not apply to this call, so it
 * leaves both sides of the ratio. A stage whose criteria were all N/A
 * contributes nothing and is not counted as 0%.
 *
 * THE STAGE MAPPING IS THE DATABASE'S. v_stage_checklist_status joins
 * evaluation_score -> rubric_criterion -> rubric_section, keeps only
 * sec.kind = 'checklist' (so the seven Non-Negotiables are excluded by
 * construction, not by a list maintained here), and maps the rubric's stored
 * rubric_criterion.stage text onto the five canonical keys. Nothing in this
 * file infers a stage from a label.
 *
 * RUBRIC VERSIONS NEVER MIX SILENTLY. The view carries no version of its own;
 * scoping is by evaluation id. Under 0077 the caller passed only evaluations on
 * the ACTIVE version, which made the question moot — and made historical months
 * impossible, because activating a new rubric did not recompute an old month,
 * it emptied it. 0078 scopes a month by the period alone and reports each
 * assessment under the version stored on it; when a period contains more than
 * one version the stage blocks are split by version rather than pooled
 * (`stageGroups`). Nothing infers that two versions' stages are equivalent.
 *
 * KNOWN LIMITATION, carried forward deliberately and not fixed here:
 * v_stage_checklist_status maps rubric_criterion.stage by exact free text
 * ('Opening', 'Discovery Call', ...). A future rubric version that spells a
 * stage differently would drop those criteria from this section silently. That
 * needs a canonical-stage correction in the database BEFORE a second version is
 * activated; it is out of scope for 0078-A.
 */

/** Rows per request. PostgREST's own default is a cap, not a promise. */
const STAGE_PAGE = 1000;
/** Ids per request, so a long roster cannot push the URL past what is accepted. */
const STAGE_ID_CHUNK = 100;

interface StageTotals {
  yes: number;
  no: number;
  na: number;
  applicable: number;
  /** Distinct evaluations that contributed at least one applicable criterion. */
  evaluations: Set<string>;
  /** Distinct evaluations with a row for this stage at all, N/A included. */
  touched: Set<string>;
}

async function stageTotals(evaluationIds: string[]): Promise<Map<string, StageTotals>> {
  const out = new Map<string, StageTotals>();
  if (evaluationIds.length === 0) return out;

  for (let i = 0; i < evaluationIds.length; i += STAGE_ID_CHUNK) {
    const chunk = evaluationIds.slice(i, i + STAGE_ID_CHUNK);
    // Paged rather than taken on trust. Five rows per evaluation means a few
    // hundred calibrations already exceed a single default page, and a
    // truncated read would not fail — it would quietly return a percentage
    // computed from part of the department and present it as all of it.
    for (let from = 0; ; from += STAGE_PAGE) {
      const { data, error } = await supabase
        .from("v_stage_checklist_status")
        .select("evaluation_id, stage, yes_items, no_items, na_items")
        .in("evaluation_id", chunk)
        .order("evaluation_id", { ascending: true })
        .order("stage", { ascending: true })
        .range(from, from + STAGE_PAGE - 1);
      // Thrown, never swallowed. The caller renders the section unavailable
      // rather than showing a stage at 0% because a read was refused.
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as {
        evaluation_id: string;
        stage: string;
        yes_items: number | null;
        no_items: number | null;
        na_items: number | null;
      }[];

      for (const r of rows) {
        const yes = r.yes_items ?? 0;
        const no = r.no_items ?? 0;
        const na = r.na_items ?? 0;
        const applicable = yes + no;
        const t = out.get(r.stage) ?? {
          yes: 0,
          no: 0,
          na: 0,
          applicable: 0,
          evaluations: new Set<string>(),
          touched: new Set<string>(),
        };
        t.yes += yes;
        t.no += no;
        t.na += na;
        t.applicable += applicable;
        t.touched.add(r.evaluation_id);
        // Only evaluations with something APPLICABLE count towards the sample.
        // An evaluation that marked every criterion in the stage N/A was looked
        // at, but it measured nothing, and counting it would make a stage look
        // better sampled than it is.
        if (applicable > 0) t.evaluations.add(r.evaluation_id);
        out.set(r.stage, t);
      }

      if (rows.length < STAGE_PAGE) break;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Disagreement, for a period (0078-A)                                         */
/* -------------------------------------------------------------------------- */

/** Rows per request, and ids per request. Same reasoning as the stage read. */
const SCORE_PAGE = 1000;
const SCORE_ID_CHUNK = 100;

/**
 * The month's comparison counts, computed from the same rows
 * v_calibration_alignment_summary is built from.
 *
 * The view itself cannot serve a month: it is aggregated to (org, rubric
 * version) and carries no date at all. This is not a widening of what anyone
 * can see — the view is security_invoker over evaluation and evaluation_score,
 * so a caller who can read it can already read these rows, and a caller who
 * cannot gets nothing from either. Same predicate, same numbers, one extra
 * dimension.
 *
 * `variance !== "agreed"` rather than `=== "changed"`: a null variance is not
 * an agreement, and the view counts it the same way (IS DISTINCT FROM).
 */
async function disagreementTotals(
  evaluationIds: string[],
): Promise<{ comparisons: number; misaligned: number }> {
  let comparisons = 0;
  let misaligned = 0;

  for (let i = 0; i < evaluationIds.length; i += SCORE_ID_CHUNK) {
    const chunk = evaluationIds.slice(i, i + SCORE_ID_CHUNK);
    for (let from = 0; ; from += SCORE_PAGE) {
      const { data, error } = await supabase
        .from("evaluation_score")
        .select("id, variance")
        .in("evaluation_id", chunk)
        .not("raw_value", "is", null)
        .not("value", "is", null)
        .order("id", { ascending: true })
        .range(from, from + SCORE_PAGE - 1);
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as { id: string; variance: string | null }[];
      for (const r of rows) {
        comparisons += 1;
        if (r.variance !== "agreed") misaligned += 1;
      }
      if (rows.length < SCORE_PAGE) break;
    }
  }
  return { comparisons, misaligned };
}

/** Shape the pooled totals into the five stage figures, in rubric order. */
function buildStages(totals: Map<string, StageTotals>): StageFigure[] {
  return STAGES.map((s) => {
    const t = totals.get(s.key);
    return {
      ...s,
      n: t ? t.evaluations.size : 0,
      touched: t ? t.touched.size : 0,
      met: t ? t.yes : 0,
      missed: t ? t.no : 0,
      na: t ? t.na : 0,
      // Null, never 0%, when nothing was applicable. A stage every evaluation
      // marked N/A was not failed; it did not apply.
      pct: t && t.applicable > 0 ? (100 * t.yes) / t.applicable : null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Which periods exist (0078-A)                                                */
/* -------------------------------------------------------------------------- */

/**
 * The months the period control offers, newest first, plus All time.
 *
 * Built from TWO timestamps — the earliest and latest submission — not from a
 * read of every assessment ever submitted. Discovering which months exist must
 * not cost the history it is describing.
 *
 * The current month is always offered even when it is empty: a reader opening
 * the Dashboard on the 1st should see this month, honestly reported as having
 * nothing yet, rather than be silently redirected to the last month that had
 * data. Months inside the span with no assessments are offered for the same
 * reason — a quiet month is a fact about the department.
 *
 * Never throws. A failed read costs the historical options, not the control.
 */
export async function availablePeriods(): Promise<Period[]> {
  const base = () =>
    supabase
      .from("evaluation")
      .select("submitted_at")
      .eq("status", "submitted")
      .is("archived_at", null)
      .not("submitted_at", "is", null);

  const current = currentMonthPeriod();
  let months: Period[] = [];

  try {
    const [first, last] = await Promise.all([
      base()
        .order("submitted_at", { ascending: true })
        .limit(1)
        .maybeSingle<{ submitted_at: string }>(),
      base()
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ submitted_at: string }>(),
    ]);
    months = monthsInSpan(
      first.data?.submitted_at ?? null,
      last.data?.submitted_at ?? null,
    );
  } catch {
    months = [];
  }

  const keys = new Set(months.map(periodKey));
  if (!keys.has(periodKey(current))) months.push(current);
  // Newest first, whatever order the span produced.
  months.sort((a, b) => periodKey(b).localeCompare(periodKey(a)));
  return months;
}

/**
 * The mean of individual assessment scores — one assessment, one vote.
 *
 * Exported because the representative rollup must use the IDENTICAL arithmetic
 * as the Calibrated Score card. Two means of the same evaluations, computed in
 * two files, is how a rep row and a headline card come to disagree by a tenth
 * and cost an afternoon.
 *
 *   overall_score when present (the database's own figure, read not recomputed)
 *   100 * yes / applicable otherwise (raw observations, which have no stored
 *   score by design), skipping any assessment with nothing applicable.
 *
 * Rounded only for display, never here.
 */
export function assessmentScoreMean(
  rows: { overall_score?: number | null; yes_count: number | null; applicable_count: number | null }[],
): number | null {
  const scores: number[] = [];
  for (const r of rows) {
    if (r.overall_score !== null && r.overall_score !== undefined) {
      scores.push(r.overall_score);
      continue;
    }
    const app = r.applicable_count ?? 0;
    if (app > 0) scores.push((100 * (r.yes_count ?? 0)) / app);
  }
  if (scores.length === 0) return null;
  return scores.reduce((a, v) => a + v, 0) / scores.length;
}

/* -------------------------------------------------------------------------- */
/* The shared picture, for a period (0078-A)                                   */
/* -------------------------------------------------------------------------- */

export async function sharedPerformance(period: Period): Promise<SharedPerformance> {
  const range = periodRange(period);

  // Every version, not just the active one: a month is reported under the
  // versions its own assessments carry, and the labels are needed to say so.
  // The table holds one row per rubric version — single figures, not history.
  const { data: versionRows, error: versionError } = await supabase
    .from("rubric_version")
    .select("id, version_label, status");
  if (versionError) throw new Error(versionError.message);
  const versions = (versionRows ?? []) as {
    id: string;
    version_label: string;
    status: string;
  }[];
  const active = versions.find((v) => v.status === "active") ?? null;
  const labelOf = (id: string): string =>
    versions.find((v) => v.id === id)?.version_label ?? "unknown";

  const empty: SharedPerformance = {
    rubricVersionId: null,
    rubricLabel: null,
    observedCount: 0,
    evaluatedCount: 0,
    observedPct: null,
    evaluatedPct: null,
    disagreements: null,
    stages: STAGES.map((s) => ({ ...s, pct: null, n: 0, touched: 0, met: 0, missed: 0, na: 0 })),
    stageGroups: null,
    nonNegotiables: null,
    rubricLabels: [],
    calibratedVersionIds: [],
  };

  // ONE MENTAL MODEL, TWO PERIODS.
  //
  //   a month  — every assessment submitted in that Philippine calendar month
  //   all time — every assessment ever submitted
  //
  // Neither asks what rubric is active today. 0078-A first shipped all time
  // with the accepted 0077 active-rubric filter, which would have quietly
  // dropped v1.0 history from "all time" the moment v2.0 was activated — the
  // same fault the monthly path was built to avoid, wearing a different label.
  // Each assessment is reported under the version stored on it, in both modes,
  // and the versions present are disclosed on screen.

  const scopedRaw = () => {
    let q = supabase
      .from("evaluation")
      .select("yes_count, applicable_count, rubric_version_id")
      .eq("kind", "raw_observation")
      .eq("status", "submitted")
      .is("archived_at", null);
    if (range) q = q.gte("submitted_at", range.startIso).lt("submitted_at", range.endIso);
    return q;
  };
  const scopedCal = () => {
    let q = supabase
      .from("evaluation")
      .select("id, yes_count, applicable_count, overall_score, rubric_version_id")
      .eq("kind", "calibrated")
      .eq("status", "submitted")
      .is("archived_at", null);
    if (range) q = q.gte("submitted_at", range.startIso).lt("submitted_at", range.endIso);
    return q;
  };
  const scopedNn = () => {
    let q = supabase
      .from("evaluation")
      .select("non_negotiables_all_pass")
      .eq("kind", "calibrated")
      .eq("status", "submitted")
      .is("archived_at", null)
      .not("non_negotiables_all_pass", "is", null);
    if (range) q = q.gte("submitted_at", range.startIso).lt("submitted_at", range.endIso);
    return q;
  };

  const [rawRows, calRows, nnRows] = await Promise.all([
    scopedRaw(),
    scopedCal(),
    scopedNn(),
  ]);

  // An error is not an empty result. `data ?? []` would turn a refused or
  // failed read into "Observed 0" and "no data yet" — a measured claim about
  // the department, made from a query that never returned.
  for (const r of [rawRows, calRows, nnRows]) {
    if (r.error) throw new Error(r.error.message);
  }

  const raw = (rawRows.data ?? []) as {
    yes_count: number;
    applicable_count: number;
    rubric_version_id: string;
  }[];
  const cal = (calRows.data ?? []) as {
    id: string;
    yes_count: number;
    applicable_count: number;
    overall_score: number | null;
    rubric_version_id: string;
  }[];

  /**
   * BOTH HEADLINE SCORES — the mean of the individual assessment scores.
   * Unchanged from the accepted 0077 follow-up; only the SET they run over is
   * now the period's rather than the active rubric's.
   *
   *   Calibrated — evaluation.overall_score, READ, not recomputed.
   *   Raw QA     — COMPUTED as 100 * yes_count / applicable_count, because
   *                recompute_evaluation() deliberately leaves overall_score
   *                null on a raw observation.
   */
  const scoreMean = assessmentScoreMean;

  // Which rubric versions this period actually contains, from the assessments
  // themselves rather than from what happens to be active today.
  const versionIds = Array.from(
    new Set([...raw, ...cal].map((r) => r.rubric_version_id).filter(Boolean)),
  );
  const rubricLabels = versionIds.map(labelOf).sort((a, b) => a.localeCompare(b));

  // Stage performance. One pooled block normally; one block PER VERSION when a
  // period genuinely spans a rubric change, because two versions' "Opening" are
  // not established to be the same question.
  const calVersions = Array.from(new Set(cal.map((r) => r.rubric_version_id)));
  let stages: StageFigure[];
  let stageGroups: StageGroup[] | null = null;

  if (calVersions.length > 1) {
    stages = empty.stages;
    const groups: StageGroup[] = [];
    for (const vid of calVersions) {
      const ids = cal.filter((r) => r.rubric_version_id === vid).map((r) => r.id);
      groups.push({
        versionId: vid,
        versionLabel: labelOf(vid),
        evaluations: ids.length,
        stages: buildStages(await stageTotals(ids)),
      });
    }
    groups.sort((a, b) => a.versionLabel.localeCompare(b.versionLabel));
    stageGroups = groups;
  } else {
    stages = buildStages(await stageTotals(cal.map((r) => r.id)));
  }

  const nn = (nnRows.data ?? []) as { non_negotiables_all_pass: boolean }[];
  const nnPassed = nn.filter((r) => r.non_negotiables_all_pass).length;
  const evaluatedCount = cal.length;

  /**
   * Disagreement.
   *
   * ALL TIME reads the accepted aggregate view, unchanged. A MONTH recomputes
   * the same counts from the same rows, because the view has no date dimension
   * — see disagreementTotals().
   *
   * Either way null means "you cannot see this", never "there were none". An
   * error here degrades this one figure rather than the section: the restricted
   * state exists precisely because Disagreements can be unreadable while every
   * other figure is fine.
   */
  let disagreements: SharedPerformance["disagreements"] = null;
  if (evaluatedCount === 0) {
    // Nothing was calibrated, so nothing was compared. Not restricted, and not
    // 0% — there is no denominator.
    disagreements = { pct: null, comparisons: 0, misaligned: 0 };
  } else {
    try {
      const t = await disagreementTotals(cal.map((r) => r.id));
      disagreements = {
        pct: t.comparisons > 0 ? (100 * t.misaligned) / t.comparisons : null,
        comparisons: t.comparisons,
        misaligned: t.misaligned,
      };
    } catch {
      // Degrades this one figure rather than the section: Disagreements can be
      // unreadable while every other number is fine.
      disagreements = null;
    }
  }

  return {
    rubricVersionId: active?.id ?? null,
    rubricLabel: active?.version_label ?? null,
    observedCount: raw.length,
    evaluatedCount,
    observedPct: scoreMean(raw),
    evaluatedPct: scoreMean(cal),
    disagreements,
    stages,
    stageGroups,
    nonNegotiables:
      nn.length > 0
        ? { pct: (100 * nnPassed) / nn.length, n: nn.length, passed: nnPassed }
        : null,
    // What the period actually contains, in both modes — never the active
    // rubric standing in for the data.
    rubricLabels,
    calibratedVersionIds: calVersions,
  };
}


/* -------------------------------------------------------------------------- */
/* Month-on-month (0078-B)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * "How did we perform in September?" was 0078-A. "How did September compare
 * with August?" is this.
 *
 * THIS IS NOT TREND. The representative Trend column compares one calibrated
 * evaluation with the one before it, whenever those happened. This compares a
 * whole month's aggregate with the whole of the month before it. They answer
 * different questions, they can point in opposite directions at the same time
 * without either being wrong, and they deliberately share no vocabulary:
 * nothing here says Improving, Declining, Stable or Baseline.
 *
 * WHAT A COMPARISON CAN HONESTLY SAY. Seven outcomes, and the reason there are
 * seven rather than one number-or-nothing is that "no delta" has several
 * causes and a reader needs to know which one they are looking at:
 *
 *   delta                     — a real, measured movement
 *   none                      — all time; there is no month before "everything"
 *   no-previous-month         — the preceding calendar month has no assessments
 *   not-comparable-last-month — last month happened, but this metric was not
 *                               measurable in it (e.g. every criterion N/A)
 *   no-data-selected          — the SELECTED month has nothing to compare from
 *   rubric-changed            — the instrument changed between the two months
 *   unavailable               — the previous month could not be READ
 *
 * The last one matters more than it looks. A failed read and an empty month are
 * indistinguishable if both render "No previous-month comparison", and one of
 * those two is a claim about the department that nobody verified.
 */
export type Comparison =
  | { kind: "delta"; value: number; unit: "pts" | "count" }
  | { kind: "none" }
  | { kind: "no-previous-month" }
  | { kind: "not-comparable-last-month" }
  | { kind: "no-data-selected" }
  | { kind: "rubric-changed" }
  | { kind: "unavailable" };

/**
 * Whether stage figures from the two months may be subtracted from each other
 * at all. Decided once for the period rather than per stage, because the reason
 * they cannot be — a rubric change — applies to every stage at once, and five
 * copies of the same sentence under five meters is noise.
 */
export type StageComparability =
  | { kind: "comparable" }
  | { kind: "none" }
  | { kind: "no-previous-month" }
  | { kind: "no-data-selected" }
  /**
   * The selected month HAS assessments, but none of them are calibrated
   * evaluations — so Stage Performance has nothing to measure this month.
   * A distinct state from "no-data-selected", which means the month is empty
   * of everything.
   */
  | { kind: "no-calibrated-selected" }
  /**
   * The previous month happened — Raw QA observed calls in it — but nobody
   * calibrated any of them, so there is no stage figure to compare against.
   *
   * This case used to fall through to "rubric-changed", which was a false
   * statement about the rubric: a month with no calibrations says nothing
   * about which version was in force, and the page was asserting that a
   * version change had occurred when the truth was simply that the
   * measurement was never taken.
   */
  | { kind: "no-calibrated-previous" }
  | { kind: "rubric-changed" }
  | { kind: "unavailable" };

export interface PerformanceComparison {
  /** The selected period's figures. Always present. */
  current: SharedPerformance;
  /**
   * The preceding calendar month's figures, or null — either because the
   * selected period is all time, or because that month could not be read.
   * `previousFailed` tells the two apart.
   */
  previous: SharedPerformance | null;
  /** The period `previous` describes, for labelling. Null for all time. */
  previousPeriod: Period | null;
  /**
   * True when a previous month EXISTS but its read threw. The page then says
   * the comparison is unavailable rather than asserting the month was empty.
   */
  previousFailed: boolean;
}

/**
 * A month is "measured" when at least one assessment was submitted in it.
 *
 * The distinction the whole comparison model rests on: a month with no
 * assessments has no measurement, so subtracting from it is subtracting from
 * an absence. "+6 vs July" would tell a reader that July was measured and came
 * out at zero, when in fact July did not happen. Counts are the tempting
 * exception — zero observations really is zero — but a count of zero in an
 * unworked month is an artefact of nobody being there, not a result, and
 * printing it beside a genuine +2 makes the two look like the same kind of
 * fact.
 */
function measured(p: SharedPerformance): boolean {
  return p.observedCount + p.evaluatedCount > 0;
}

/**
 * The outcomes that do not depend on which metric is being compared.
 *
 * Its return type is the INTERSECTION of what both Comparison and
 * StageComparability admit, so both callers can return it unchanged. Typing it
 * as Comparison and casting at the stage call site would have been one
 * assertion away from letting a "delta" escape into a union that has no place
 * for one.
 */
type StructuralOutcome =
  | { kind: "none" }
  | { kind: "no-previous-month" }
  | { kind: "no-data-selected" }
  | { kind: "unavailable" };

function structural(c: PerformanceComparison): StructuralOutcome | null {
  if (c.previousPeriod === null) return { kind: "none" };
  if (c.previousFailed || c.previous === null) return { kind: "unavailable" };
  if (!measured(c.current)) return { kind: "no-data-selected" };
  if (!measured(c.previous)) return { kind: "no-previous-month" };
  return null;
}

/**
 * Percentage-point movement for a percentage metric.
 *
 * Percentages compare across rubric versions deliberately: Observed Score,
 * Calibrated Score and the Non-Negotiables pass rate are ASSESSMENT-level
 * measures, and every assessment carries its own complete measurement under
 * whichever rubric it was submitted against. Stage performance does not have
 * that property, which is why it has its own gate below.
 */
export function comparePercent(
  c: PerformanceComparison,
  pick: (p: SharedPerformance) => number | null,
): Comparison {
  const structuralResult = structural(c);
  if (structuralResult) return structuralResult;
  const now = pick(c.current);
  const then = pick(c.previous as SharedPerformance);
  // This month has no value to compare FROM. The figure already renders as an
  // em dash; a comparison line under it would be explaining an absence that is
  // already visible.
  if (now === null) return { kind: "none" };
  if (then === null) return { kind: "not-comparable-last-month" };
  return { kind: "delta", value: now - then, unit: "pts" };
}

/**
 * Absolute movement for a true count.
 *
 * A previous count of zero inside a MEASURED month is a real zero and is
 * compared normally — the month happened, and nothing of this kind was
 * submitted in it. That is a different fact from an unworked month, which
 * `structural` has already filtered out above.
 */
export function compareCount(
  c: PerformanceComparison,
  pick: (p: SharedPerformance) => number,
): Comparison {
  const structuralResult = structural(c);
  if (structuralResult) return structuralResult;
  return {
    kind: "delta",
    value: pick(c.current) - pick(c.previous as SharedPerformance),
    unit: "count",
  };
}

/**
 * Whether the two months' stages were measured with the same instrument.
 *
 * LIKE FOR LIKE OR NOT AT ALL. copy_rubric_version() clones every criterion
 * into new rows, so v2.0's "Opening" is a different set of questions from
 * v1.0's — possibly a different number of them, possibly asking something else
 * entirely. Nothing in the schema records that two versions' stages are
 * equivalent, and no amount of matching stage NAMES establishes it. So the
 * comparison renders only when both months were calibrated against exactly one
 * rubric version and it is the same one; otherwise the page says the rubric
 * changed, which is the true and useful answer.
 *
 * A month that itself spans two versions fails this test by construction — it
 * has no single instrument to compare with — and keeps the 0078-A split blocks.
 */
export function stageComparability(c: PerformanceComparison): StageComparability {
  // NOT `structural()`, deliberately, and the reason is the whole correction.
  //
  // `structural()` asks whether a month was measured AT ALL —
  // observedCount + evaluatedCount > 0 — which is the right question for every
  // headline card, because those measure both kinds of assessment. STAGE
  // PERFORMANCE IS CALIBRATED-ONLY. A month in which Raw QA observed four calls
  // and nobody calibrated any of them is "measured" by the generic test and
  // completely unmeasured by this section's.
  //
  // Running the generic test first and then reading calibratedVersionIds sent
  // that month into the version comparison with an EMPTY version list, where
  // `then.length !== 1` produced "Rubric changed — not comparable". The rubric
  // had not changed. Nothing had been calibrated. The page was explaining an
  // absence with the wrong cause, and the wrong cause happened to be the one
  // that sounds like a governance event.
  //
  // The order below is the semantics, not an optimisation: the SELECTED month's
  // own ability to be measured is settled before anything is said about the
  // previous one, because five empty meters are explained by "nothing was
  // calibrated this month", not by a fact about last month.
  if (c.previousPeriod === null) return { kind: "none" };
  if (c.previousFailed || c.previous === null) return { kind: "unavailable" };

  // The selected month, first.
  if (!measured(c.current)) return { kind: "no-data-selected" };
  const now = c.current.calibratedVersionIds;
  if (now.length === 0) return { kind: "no-calibrated-selected" };

  // Then the month it would be compared against.
  if (!measured(c.previous)) return { kind: "no-previous-month" };
  const then = c.previous.calibratedVersionIds;
  if (then.length === 0) return { kind: "no-calibrated-previous" };

  // Both months were calibrated. Like for like, or not at all: one version
  // each, and the same one. More than one version on either side keeps the
  // conservative answer — a month spanning a rubric change has no single
  // instrument to compare with, and nothing in the schema establishes that two
  // versions' stages ask the same questions.
  if (now.length !== 1 || then.length !== 1 || now[0] !== then[0]) {
    return { kind: "rubric-changed" };
  }
  return { kind: "comparable" };
}

/** One stage's movement, once `stageComparability` has allowed it. */
export function compareStage(
  c: PerformanceComparison,
  key: string,
): Comparison {
  const gate = stageComparability(c);
  // The two calibrated-only states have no place in the generic Comparison
  // union — no headline metric can produce them — so they are translated here
  // rather than widening a type that eleven other figures share.
  //
  // "nothing calibrated this month" renders nothing per meter: the meter
  // already says "No data yet" in its own words, and the section note carries
  // the explanation once. "nothing calibrated last month" is exactly the
  // existing not-comparable-last-month case and reuses its sentence.
  if (gate.kind === "no-calibrated-selected") return { kind: "none" };
  if (gate.kind === "no-calibrated-previous") return { kind: "not-comparable-last-month" };
  if (gate.kind !== "comparable") return gate;
  const now = c.current.stages.find((s) => s.key === key)?.pct ?? null;
  const prev = (c.previous as SharedPerformance).stages.find((s) => s.key === key)?.pct ?? null;
  // Every criterion N/A this month, or the stage never touched: the meter
  // already says so in its own words.
  if (now === null) return { kind: "none" };
  // Measured now, not measurable then — an all-N/A stage last month is not 0%
  // and must never be subtracted from as though it were.
  if (prev === null) return { kind: "not-comparable-last-month" };
  return { kind: "delta", value: now - prev, unit: "pts" };
}

/**
 * The selected period's figures and, for a month, the preceding month's.
 *
 * ONE EXTRA LOAD, NOT ONE PER CARD. The previous month goes through the very
 * same sharedPerformance() the selected one does — same predicates, same
 * paging, same arithmetic — so the two sides of every subtraction are provably
 * built the same way, and the read cost is bounded at exactly twice a month
 * rather than growing with the number of comparisons on screen. A per-metric or
 * per-stage query would have been an N+1 in a section that renders eleven
 * figures.
 *
 * ALL TIME COSTS NOTHING EXTRA. It has no previous month, so it issues exactly
 * the reads 0078-A issued. That matters now that all time is the default view.
 *
 * A FAILED PREVIOUS READ DEGRADES THE COMPARISON, NOT THE PAGE. The selected
 * month's figures are the page's job; last month's are context. If the context
 * cannot be fetched the page still renders, and says so.
 */
export async function sharedPerformanceWithComparison(
  period: Period,
): Promise<PerformanceComparison> {
  const previousPeriod = previousMonthPeriod(period);
  if (previousPeriod === null) {
    return {
      current: await sharedPerformance(period),
      previous: null,
      previousPeriod: null,
      previousFailed: false,
    };
  }

  const [current, previous] = await Promise.all([
    sharedPerformance(period),
    sharedPerformance(previousPeriod).catch(() => null),
  ]);

  return {
    current,
    previous,
    previousPeriod,
    previousFailed: previous === null,
  };
}
