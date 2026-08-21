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
