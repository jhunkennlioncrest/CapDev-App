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
  recent: {
    id: string;
    call_id: string;
    call_title: string;
    representative_name: string | null;
    submitted_at: string;
    /** Whether a trainer has since calibrated it. */
    calibrated: boolean;
  }[];
}

/**
 * The reviewer's own work — not the organisation's.
 *
 * The previous dashboard counted org-wide calibrations here, so a reviewer who
 * had submitted three observations could still see zero.
 */
export async function reviewerFigures(personId: string): Promise<ReviewerFigures> {
  const since = startOfWeek().toISOString();

  const [week, recent] = await Promise.all([
    supabase
      .from("evaluation")
      .select("id", { count: "exact", head: true })
      .eq("evaluator_id", personId)
      .eq("kind", "raw_observation")
      .eq("status", "submitted")
      .gte("submitted_at", since),
    supabase
      .from("evaluation")
      .select("id, call_id, submitted_at, call!inner(title, representative_id)")
      .eq("evaluator_id", personId)
      .eq("kind", "raw_observation")
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(6),
  ]);

  const rows = (recent.data ?? []) as unknown as {
    id: string;
    call_id: string;
    submitted_at: string;
    call: { title: string; representative_id: string | null };
  }[];

  // Which of those observations a trainer has since calibrated, so the
  // reviewer can see what has come back rather than guessing.
  const callIds = rows.map((r) => r.call_id);
  const calibrated = new Set<string>();
  if (callIds.length > 0) {
    const { data } = await supabase
      .from("evaluation")
      .select("call_id")
      .in("call_id", callIds)
      .eq("kind", "calibrated")
      .eq("status", "submitted");
    for (const c of (data ?? []) as { call_id: string }[]) calibrated.add(c.call_id);
  }

  // Representative names come from the canonical directory, never from a
  // typed agent_name.
  const repIds = [...new Set(rows.map((r) => r.call?.representative_id).filter(Boolean))];
  const names = new Map<string, string>();
  if (repIds.length > 0) {
    const { data } = await supabase
      .from("person")
      .select("id, display_name")
      .in("id", repIds as string[]);
    for (const p of (data ?? []) as { id: string; display_name: string }[]) {
      names.set(p.id, p.display_name);
    }
  }

  return {
    completedThisWeek: week.count ?? 0,
    recent: rows.map((r) => ({
      id: r.id,
      call_id: r.call_id,
      call_title: r.call?.title ?? "Untitled",
      representative_name: r.call?.representative_id
        ? (names.get(r.call.representative_id) ?? null)
        : null,
      submitted_at: r.submitted_at,
      calibrated: calibrated.has(r.call_id),
    })),
  };
}

export interface TrainerFigures {
  /** Calibrations this trainer submitted since Monday. */
  completedThisWeek: number;
  recent: {
    id: string;
    call_id: string;
    call_title: string;
    representative_name: string | null;
    score: number | null;
    disagreements: number;
    submitted_at: string;
  }[];
}

/** The trainer's own completed calibrations, with their variance counts. */
export async function trainerFigures(personId: string): Promise<TrainerFigures> {
  const since = startOfWeek().toISOString();

  const [week, recent] = await Promise.all([
    supabase
      .from("evaluation")
      .select("id", { count: "exact", head: true })
      .eq("evaluator_id", personId)
      .eq("kind", "calibrated")
      .eq("status", "submitted")
      .gte("submitted_at", since),
    // v_quality_repository already assembles score, representative and title
    // for completed calibrations — reused rather than queried again.
    supabase
      .from("v_quality_repository")
      .select("*")
      .order("submitted_at", { ascending: false })
      .limit(6),
  ]);

  const rows = (recent.data ?? []) as {
    evaluation_id: string;
    call_id: string;
    call_title: string;
    agent_name: string | null;
    overall_score: number | null;
    submitted_at: string;
  }[];

  // v_quality_repository carries agent_name — the text typed on the call. The
  // canonical name comes from the directory, so it is resolved here rather
  // than showing a spelling that may not match the representative's record.
  const canonical = new Map<string, string>();
  if (rows.length > 0) {
    const { data } = await supabase
      .from("call")
      .select("id, person:representative_id(display_name)")
      .in("id", rows.map((r) => r.call_id));
    for (const c of (data ?? []) as unknown as {
      id: string;
      person: { display_name: string } | null;
    }[]) {
      if (c.person?.display_name) canonical.set(c.id, c.person.display_name);
    }
  }

  // Disagreement counts come from the calibration comparison view — the same
  // source as Calibration Accuracy, not a second calculation.
  const evalIds = rows.map((r) => r.evaluation_id);
  const variance = new Map<string, number>();
  if (evalIds.length > 0) {
    const { data } = await supabase
      .from("v_calibration_comparison")
      .select("calibrated_evaluation_id")
      .in("calibrated_evaluation_id", evalIds)
      .eq("aligned", false);
    for (const d of (data ?? []) as { calibrated_evaluation_id: string }[]) {
      variance.set(
        d.calibrated_evaluation_id,
        (variance.get(d.calibrated_evaluation_id) ?? 0) + 1,
      );
    }
  }

  return {
    completedThisWeek: week.count ?? 0,
    recent: rows.map((r) => ({
      id: r.evaluation_id,
      call_id: r.call_id,
      call_title: r.call_title,
      representative_name: canonical.get(r.call_id) ?? r.agent_name,
      score: r.overall_score,
      disagreements: variance.get(r.evaluation_id) ?? 0,
      submitted_at: r.submitted_at,
    })),
  };
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
  /** avg(score) / 5 * 100, or null when the stage has never been scored. */
  pct: number | null;
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
  disagreements: { pct: number; comparisons: number } | null;
  stages: StageFigure[];
  nonNegotiables: { pct: number; n: number } | null;
}

/** The five scored stages, in rubric order, with the labels the business uses. */
const STAGES: { key: string; label: string }[] = [
  { key: "opening", label: "Opening" },
  { key: "problem_discovery", label: "Discovery Call" },
  { key: "collaborative_problem_solving", label: "Collaborative Problem Solving" },
  { key: "timeline_transparency", label: "Timeline Transparency" },
  { key: "professional_closing", label: "Closing" },
];

/** Below this a percentage is reported with a caution rather than alone. */
export const LOW_SAMPLE = 5;

export async function sharedPerformance(): Promise<SharedPerformance> {
  // The active rubric, resolved the same way evaluation.ts resolves it, so the
  // Dashboard and the scoring path can never disagree about which rubric is
  // current.
  const { data: rubric } = await supabase
    .from("rubric_version")
    .select("id, version_label")
    .eq("status", "active")
    .limit(1)
    .maybeSingle<{ id: string; version_label: string }>();

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

  const [rawRows, calRows, alignment, stageRows, nnRows] = await Promise.all([
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
      .select("yes_count, applicable_count")
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
    supabase
      .from("evaluation_stage_score")
      .select("stage, score, evaluation!inner(kind, status, archived_at, rubric_version_id)")
      .eq("evaluation.kind", "calibrated")
      .eq("evaluation.status", "submitted")
      .is("evaluation.archived_at", null)
      .eq("evaluation.rubric_version_id", versionId),
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

  const pooled = (
    rows: { yes_count: number | null; applicable_count: number | null }[] | null,
  ): number | null => {
    const yes = (rows ?? []).reduce((a, r) => a + (r.yes_count ?? 0), 0);
    const app = (rows ?? []).reduce((a, r) => a + (r.applicable_count ?? 0), 0);
    return app > 0 ? (100 * yes) / app : null;
  };

  const raw = (rawRows.data ?? []) as { yes_count: number; applicable_count: number }[];
  const cal = (calRows.data ?? []) as { yes_count: number; applicable_count: number }[];

  const stages = (stageRows.data ?? []) as unknown as { stage: string; score: number }[];
  const byStage = STAGES.map((s) => {
    const mine = stages.filter((x) => x.stage === s.key);
    const n = mine.length;
    return {
      ...s,
      n,
      // 0-5 scored, shown out of 5. No rubric maximum is hard-coded anywhere
      // else; this one is the stage scale itself, fixed by the column's own
      // CHECK (score >= 0 AND score <= 5).
      pct: n > 0 ? (100 * mine.reduce((a, x) => a + x.score, 0)) / (5 * n) : null,
    };
  });

  const nn = (nnRows.data ?? []) as { non_negotiables_all_pass: boolean }[];
  const nnPassed = nn.filter((r) => r.non_negotiables_all_pass).length;

  const evaluatedCount = cal.length;
  const align = alignment.data;

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
      ? { pct: (100 * align.misaligned) / align.comparisons, comparisons: align.comparisons }
      : evaluatedCount === 0
        ? { pct: 0, comparisons: 0 }
        : null,
    stages: byStage,
    nonNegotiables: nn.length > 0 ? { pct: (100 * nnPassed) / nn.length, n: nn.length } : null,
  };
}
