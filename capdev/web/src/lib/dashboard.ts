import { supabase } from "@/lib/supabase";

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

/** Monday of the current week, local time. The labelled period for both roles. */
export function startOfWeek(): Date {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface ReviewerFigures {
  /** Observations this reviewer submitted since Monday. */
  completedThisWeek: number;
}

/**
 * The reviewer's own work — not the organisation's.
 *
 * The previous dashboard counted org-wide calibrations here, so a reviewer who
 * had submitted three observations could still see zero.
 *
 * One count, and nothing else. This used to also assemble the six most recent
 * observations, their representatives' canonical names, and whether a trainer
 * had calibrated each one since — three further round trips feeding a "Recent
 * observations" list the Dashboard no longer shows. That history is still in
 * the Library and on Rep Performance; paying for it here bought a list nobody
 * decided anything from.
 */
export async function reviewerFigures(personId: string): Promise<ReviewerFigures> {
  const { count } = await supabase
    .from("evaluation")
    .select("id", { count: "exact", head: true })
    .eq("evaluator_id", personId)
    .eq("kind", "raw_observation")
    .eq("status", "submitted")
    .gte("submitted_at", startOfWeek().toISOString());

  return { completedThisWeek: count ?? 0 };
}

export interface TrainerFigures {
  /** Calibrations this trainer submitted since Monday. */
  completedThisWeek: number;
}

/**
 * The trainer's own completed calibrations, as one number.
 *
 * Trimmed alongside reviewerFigures: the six most recent calibrations, their
 * canonical representative names and their per-evaluation disagreement counts
 * were read from v_quality_repository, call and v_calibration_comparison for a
 * "Recent calibrations" list that is gone. Department-level alignment is in the
 * shared Performance section; a trainer's own history is in the Library.
 */
export async function trainerFigures(personId: string): Promise<TrainerFigures> {
  const { count } = await supabase
    .from("evaluation")
    .select("id", { count: "exact", head: true })
    .eq("evaluator_id", personId)
    .eq("kind", "calibrated")
    .eq("status", "submitted")
    .gte("submitted_at", startOfWeek().toISOString());

  return { completedThisWeek: count ?? 0 };
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
   * this stage — not criterion rows. The label beside it reads "n=", and a
   * reader takes that to mean calls looked at; a criterion count would inflate
   * it several-fold and make "Limited data" disappear exactly when it matters.
   */
  n: number;
}

export interface SharedPerformance {
  rubricVersionId: string | null;
  rubricLabel: string | null;
  observedCount: number;
  evaluatedCount: number;
  observedPct: number | null;
  evaluatedPct: number | null;
  /**
   * null means the figure could not be read, NOT that it is zero. The two are
   * indistinguishable under RLS, and rendering an unreadable figure as 0%
   * would claim perfect alignment where the truth is "you cannot see this".
   */
  disagreements: { pct: number; comparisons: number; misaligned: number } | null;
  stages: StageFigure[];
  nonNegotiables: { pct: number; n: number; passed: number } | null;
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
 * RUBRIC VERSIONS NEVER MIX. The view carries no version of its own; scoping
 * is by evaluation id, and the caller passes only evaluations already filtered
 * to the active rubric_version_id. When a new version is activated, this
 * follows it automatically and cannot drag the old criteria along.
 */

/** Rows per request. PostgREST's own default is a cap, not a promise. */
const STAGE_PAGE = 1000;
/** Ids per request, so a long roster cannot push the URL past what is accepted. */
const STAGE_ID_CHUNK = 100;

interface StageTotals {
  yes: number;
  applicable: number;
  /** Distinct evaluations that contributed at least one applicable criterion. */
  evaluations: Set<string>;
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
        .select("evaluation_id, stage, yes_items, no_items")
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
      }[];

      for (const r of rows) {
        const yes = r.yes_items ?? 0;
        const applicable = yes + (r.no_items ?? 0);
        if (applicable === 0) continue;
        const t = out.get(r.stage) ?? { yes: 0, applicable: 0, evaluations: new Set<string>() };
        t.yes += yes;
        t.applicable += applicable;
        t.evaluations.add(r.evaluation_id);
        out.set(r.stage, t);
      }

      if (rows.length < STAGE_PAGE) break;
    }
  }
  return out;
}

export async function sharedPerformance(): Promise<SharedPerformance> {
  // The active rubric, resolved the same way evaluation.ts resolves it, so the
  // Dashboard and the scoring path can never disagree about which rubric is
  // current.
  const { data: rubric, error: rubricError } = await supabase
    .from("rubric_version")
    .select("id, version_label")
    .eq("status", "active")
    .limit(1)
    .maybeSingle<{ id: string; version_label: string }>();
  // "No active rubric" and "the read failed" are different answers and must
  // not share a return value. The first is legitimately nothing to show; the
  // second is thrown, so the caller renders its unavailable path rather than
  // a section full of zeroes.
  if (rubricError) throw new Error(rubricError.message);

  const empty: SharedPerformance = {
    rubricVersionId: null,
    rubricLabel: null,
    observedCount: 0,
    evaluatedCount: 0,
    observedPct: null,
    evaluatedPct: null,
    disagreements: null,
    stages: STAGES.map((s) => ({ ...s, pct: null, n: 0 })),
    nonNegotiables: null,
  };
  if (!rubric) return empty;

  const versionId = rubric.id;

  const [rawRows, calRows, alignment, nnRows] = await Promise.all([
    // Counts and totals come from the same read: yes_count and
    // applicable_count are summed here rather than averaged, because two
    // evaluations can have different applicable denominators once criteria are
    // N/A, and averaging their percentages would weight a four-criterion call
    // the same as a fifteen-criterion one.
    supabase
      .from("evaluation")
      .select("yes_count, applicable_count")
      .eq("kind", "raw_observation")
      .eq("status", "submitted")
      .is("archived_at", null)
      .eq("rubric_version_id", versionId),
    supabase
      .from("evaluation")
      .select("id, yes_count, applicable_count")
      .eq("kind", "calibrated")
      .eq("status", "submitted")
      .is("archived_at", null)
      .eq("rubric_version_id", versionId),
    // Anonymous aggregate. v_calibration_comparison stays self-only and
    // untouched; this carries counts and nothing attributable to a person.
    supabase
      .from("v_calibration_alignment_summary")
      .select("comparisons, misaligned")
      .eq("rubric_version_id", versionId)
      .maybeSingle<{ comparisons: number; misaligned: number }>(),
    // A null non_negotiables_all_pass is not a failure — it is an evaluation
    // that carries no authoritative Non-Negotiables result, and it is excluded
    // from both sides of the fraction rather than counted against anyone.
    supabase
      .from("evaluation")
      .select("non_negotiables_all_pass")
      .eq("kind", "calibrated")
      .eq("status", "submitted")
      .is("archived_at", null)
      .eq("rubric_version_id", versionId)
      .not("non_negotiables_all_pass", "is", null),
  ]);

  // An error is not an empty result. `data ?? []` would turn a refused or
  // failed read into "Observed 0" and "no data yet" — a measured claim about
  // the department, made from a query that never returned. Every read that
  // feeds a figure is checked before any figure is computed.
  for (const r of [rawRows, calRows, nnRows]) {
    if (r.error) throw new Error(r.error.message);
  }

  const pooled = (
    rows: { yes_count: number | null; applicable_count: number | null }[] | null,
  ): number | null => {
    const yes = (rows ?? []).reduce((a, r) => a + (r.yes_count ?? 0), 0);
    const app = (rows ?? []).reduce((a, r) => a + (r.applicable_count ?? 0), 0);
    return app > 0 ? (100 * yes) / app : null;
  };

  const raw = (rawRows.data ?? []) as { yes_count: number; applicable_count: number }[];
  const cal = (calRows.data ?? []) as {
    id: string;
    yes_count: number;
    applicable_count: number;
  }[];

  // Sequential, and deliberately so: the stage read is scoped by the exact
  // evaluation ids the calibrated read just returned. Embedding
  // `evaluation!inner` would keep it in the batch above, but PostgREST infers
  // an embed's relationship from foreign keys, and the stage source is a VIEW
  // with none — so the filter is applied here, where it is provable, rather
  // than left to inference that could silently widen the population.
  const totals = await stageTotals(cal.map((r) => r.id));
  const byStage = STAGES.map((s) => {
    const t = totals.get(s.key);
    return {
      ...s,
      n: t ? t.evaluations.size : 0,
      pct: t && t.applicable > 0 ? (100 * t.yes) / t.applicable : null,
    };
  });

  const nn = (nnRows.data ?? []) as { non_negotiables_all_pass: boolean }[];
  const nnPassed = nn.filter((r) => r.non_negotiables_all_pass).length;

  const evaluatedCount = cal.length;
  // Deliberately NOT thrown. The whole point of the restricted state is that
  // Disagreements can be unreadable while every other figure is fine, so an
  // error here degrades this one figure instead of the section. It is folded
  // into the same null the "row absent while calibrations exist" case
  // produces — both mean "you cannot see this" — while a clean read of no row
  // with no calibrations stays the genuine zero-data answer.
  const alignFailed = alignment.error !== null && alignment.error !== undefined;
  const align = alignFailed ? null : alignment.data;

  return {
    rubricVersionId: versionId,
    rubricLabel: rubric.version_label,
    observedCount: raw.length,
    evaluatedCount,
    observedPct: pooled(raw),
    evaluatedPct: pooled(cal),
    // Distinguishing "nothing to compare yet" from "you may not see this":
    // with no calibrations at all there is genuinely nothing, and that is a
    // zero-data state rather than a restricted one. A missing row while
    // calibrations DO exist means the read was refused.
    disagreements: align
      ? {
          pct: (100 * align.misaligned) / align.comparisons,
          comparisons: align.comparisons,
          // Carried through rather than reconstructed from the percentage:
          // "2 of 105" is the readable form of the same number the view
          // already returned. No new query, no new arithmetic.
          misaligned: align.misaligned,
        }
      : !alignFailed && evaluatedCount === 0
        ? { pct: 0, comparisons: 0, misaligned: 0 }
        : null,
    stages: byStage,
    // nnPassed likewise: already counted above, now also carried, so the card
    // can say "7 of 8 evaluations passed" without deriving it back out of a
    // rounded percentage.
    nonNegotiables:
      nn.length > 0
        ? { pct: (100 * nnPassed) / nn.length, n: nn.length, passed: nnPassed }
        : null,
  };
}
