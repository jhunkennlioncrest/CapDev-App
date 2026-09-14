import { supabase } from "@/lib/supabase";
import {
  currentMonthPeriod,
  monthsInSpan,
  periodKey,
  periodRange,
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
  disagreements: { pct: number; comparisons: number; misaligned: number } | null;
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
  };

  // ALL TIME KEEPS THE ACCEPTED 0077 SCOPING: the active rubric, exactly as
  // released. A month does not — it is scoped by the period alone, and each
  // assessment is reported under the version stored on it. That difference is
  // deliberate and is the one place the two modes disagree; it is stated in the
  // 0078-A record rather than buried here.
  if (!range && !active) return empty;

  const scopedRaw = () => {
    let q = supabase
      .from("evaluation")
      .select("yes_count, applicable_count, rubric_version_id")
      .eq("kind", "raw_observation")
      .eq("status", "submitted")
      .is("archived_at", null);
    if (range) q = q.gte("submitted_at", range.startIso).lt("submitted_at", range.endIso);
    else if (active) q = q.eq("rubric_version_id", active.id);
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
    else if (active) q = q.eq("rubric_version_id", active.id);
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
    else if (active) q = q.eq("rubric_version_id", active.id);
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
  if (range) {
    if (evaluatedCount === 0) {
      disagreements = { pct: 0, comparisons: 0, misaligned: 0 };
    } else {
      try {
        const t = await disagreementTotals(cal.map((r) => r.id));
        disagreements =
          t.comparisons > 0
            ? { pct: (100 * t.misaligned) / t.comparisons, comparisons: t.comparisons, misaligned: t.misaligned }
            : { pct: 0, comparisons: 0, misaligned: 0 };
      } catch {
        disagreements = null;
      }
    }
  } else if (active) {
    const alignment = await supabase
      .from("v_calibration_alignment_summary")
      .select("comparisons, misaligned")
      .eq("rubric_version_id", active.id)
      .maybeSingle<{ comparisons: number; misaligned: number }>();
    const alignFailed = alignment.error !== null && alignment.error !== undefined;
    const align = alignFailed ? null : alignment.data;
    disagreements = align
      ? {
          pct: (100 * align.misaligned) / align.comparisons,
          comparisons: align.comparisons,
          misaligned: align.misaligned,
        }
      : !alignFailed && evaluatedCount === 0
        ? { pct: 0, comparisons: 0, misaligned: 0 }
        : null;
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
    // All time states the active rubric it is scoped to; a month states what it
    // actually contains.
    rubricLabels: range ? rubricLabels : active ? [active.version_label] : [],
  };
}
