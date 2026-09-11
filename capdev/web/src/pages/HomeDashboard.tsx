import { useCallback, useEffect, useState } from "react";
import { CalibrationAccuracySection } from "@/pages/CalibrationAccuracySection";
import { RepPerformanceSummary } from "@/pages/RepPerformanceSummary";
import { PerformanceOverview } from "@/pages/PerformanceOverview";
import { getQueue } from "@/lib/evaluation";
import { getRawWorklist } from "@/lib/workflow";
import { listRepository, statsFrom } from "@/lib/repository";
import {
  reviewerFigures,
  trainerFigures,
  type ReviewerFigures,
  type TrainerFigures,
} from "@/lib/dashboard";
import { supabase } from "@/lib/supabase";
import type { Session } from "@/lib/types";
import type { Workspace } from "@/components/AppShell";

interface Counts {
  pendingRaw: number;
  waitingCalibration: number;
  /** How many completed evaluations the representative figure is drawn from. */
  completedEvaluations: number;
  moments: number;
  averageScore: number | null;
}

/**
 * Operational awareness, filtered by role.
 *
 * A reviewer sees what needs observing; a trainer sees what needs calibrating.
 * Nobody sees counts for work they cannot do — an unactionable number is noise.
 */
export function HomeDashboard({
  session,
  onNavigate,
  onOpenRepPerformance,
}: {
  session: Session;
  onNavigate: (w: Workspace) => void;
  onOpenCall: (callId: string) => void;
  /** Rep performance lives under the Dashboard, not as its own workspace. */
  onOpenRepPerformance?: (repId?: string) => void;
}): JSX.Element {
  const [counts, setCounts] = useState<Counts | null>(null);
  const canReview = session.permissions.includes("raw_qa.submit");
  const canCalibrate = session.permissions.includes("calibration.perform");
  // Reading performance is not authority over it. This gate mirrors the RLS
  // predicate guarding evaluation data; it never widens what the database will
  // return, and it grants no action anywhere.
  const canSeePerformance = session.permissions.includes("evaluation.read");
  // Role-scoped figures, kept apart from the org-wide repository stats the
  // Repository page uses.
  const [mine, setMine] = useState<ReviewerFigures | null>(null);
  const [trainer, setTrainer] = useState<TrainerFigures | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const [raw, queue, repo, moments, r, t] = await Promise.all([
      canReview ? getRawWorklist() : Promise.resolve([]),
      canCalibrate ? getQueue() : Promise.resolve([]),
      // Still loaded: the trainer's Representative Performance figure and the
      // repository's own statistics both come from here.
      listRepository(),
      supabase.from("moment").select("id", { count: "exact", head: true }).is("archived_at", null),
      canReview && !canCalibrate
        ? reviewerFigures(session.person.id)
        : Promise.resolve(null),
      canCalibrate ? trainerFigures(session.person.id) : Promise.resolve(null),
    ]);
    setMine(r);
    setTrainer(t);

    const stats = statsFrom(repo);

    setCounts({
      pendingRaw: raw.length,
      waitingCalibration: queue.filter((q) => q.status === "waiting").length,
      completedEvaluations: stats.completed,
      moments: moments.count ?? 0,
      averageScore: stats.averageScore,
    });
  }, [canReview, canCalibrate, session.person.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <header className="pt-8 pb-6">
        <h1 className="font-display text-3xl">
          {greeting}, {session.person.display_name?.split(" ")[0] ?? "there"}
        </h1>
      </header>

      {counts === null ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {canReview && (
              <Card
                value={counts.pendingRaw}
                label="waiting for your review"
                action="Open Raw QA"
                onClick={() => onNavigate("rawqa")}
                emphasis={counts.pendingRaw > 0}
              />
            )}
            {canCalibrate && (
              <Card
                value={counts.waitingCalibration}
                label="ready for calibration"
                action="Open Calibration"
                onClick={() => onNavigate("calibration")}
                emphasis={counts.waitingCalibration > 0}
              />
            )}
            {/* The period is stated, and the count is this person's own work
                — not the organisation's, which is what "completed today"
                silently showed before.

                Gated on actually holding a QA workflow role. Without the gate
                a Manager or Executive — who neither observes nor calibrates —
                fell through to `mine?.completedThisWeek ?? 0` and was shown
                "0 observations you completed this week": a personal figure for
                work the role does not do, and a zero that describes nothing.
                Management reads org-wide Observed and Evaluated counts from
                the shared Performance section below instead. */}
            {(canReview || canCalibrate) && (
              <Card
                value={
                  canCalibrate
                    ? (trainer?.completedThisWeek ?? 0)
                    : (mine?.completedThisWeek ?? 0)
                }
                label={
                  canCalibrate
                    ? "calibrations you completed this week"
                    : "observations you completed this week"
                }
                action="See the library"
                onClick={() => onNavigate("library")}
              />
            )}
          </div>

          {/* Representative performance and the Library count belong to the
              trainer's remit. On a reviewer's dashboard the first is not their
              score and the second is not something they can create, so neither
              appears there. */}
          {canCalibrate && (
            <div className="grid grid-cols-2 border-y border-rule mt-7">
              <Figure
                value={counts.averageScore === null ? "—" : `${counts.averageScore}%`}
                caption="representative performance"
                detail={
                  counts.averageScore === null
                    ? "no completed evaluations yet"
                    : `${counts.completedEvaluations} completed evaluation${counts.completedEvaluations === 1 ? "" : "s"}`
                }
              />
              <Figure
                value={String(counts.moments)}
                caption="active teaching moments"
                detail="in the Library"
              />
            </div>
          )}

          {/* A different question from "average score" above: that is the
              representative's result, this is how closely the reviewer's
              observations matched the trainer's final decisions. */}
          <CalibrationAccuracySection session={session} />

          {/* "Recent observations" and "Recent calibrations" used to sit here.
              They were a log, not a decision: a reviewer already knows what
              they submitted, and neither list changed what anyone would do
              next. The history itself is untouched — it is in the Library, on
              Rep Performance and on each call. Removing the panels also
              retired the five queries that fed them (see dashboard.ts). */}
        </>
      )}
      {/* 0077: the shared performance picture, below the personal work and
          never in place of it. Every role that can read evaluations sees the
          same figures — including Raw QA, deliberately. A reviewer who cannot
          see where the calibrated assessment lands has nothing to calibrate
          against, and the earlier reasoning for hiding it (that a reviewer
          should not weigh historical performance mid-observation) protected
          them from information rather than from a mistake.

          The gate is evaluation.read because that is already the RLS predicate
          on every table underneath: the UI and the database agree by
          construction rather than by upkeep. It grants nothing — calibration,
          submission and management authority are elsewhere and untouched. */}
      {canSeePerformance && <PerformanceOverview />}

      {canSeePerformance && onOpenRepPerformance && (
        <RepPerformanceSummary onOpen={onOpenRepPerformance} />
      )}

    </div>
  );
}

function Card({
  value,
  label,
  action,
  onClick,
  emphasis = false,
}: {
  value: number;
  label: string;
  action: string;
  onClick: () => void;
  emphasis?: boolean;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-card border rounded px-5 py-4 hover:bg-ground-2 transition-colors ${
        emphasis ? "border-ink" : "border-rule-soft"
      }`}
    >
      <span className="font-display text-4xl block leading-none">{value}</span>
      <span className="text-[13px] text-ink-70 block mt-1.5">{label}</span>
      <span className="text-[12px] text-ink-45 block mt-2 underline underline-offset-2">
        {action}
      </span>
    </button>
  );
}

function Figure({
  value,
  caption,
  detail,
}: {
  value: string;
  caption: string;
  /** What the number covers. Every figure states its own scope. */
  detail?: string;
}): JSX.Element {
  return (
    <div className="py-4 pr-5 border-r border-rule-soft last:border-r-0">
      <span className="font-display text-2xl block leading-none mb-1">{value}</span>
      <span className="text-[11.5px] text-ink-45 block">{caption}</span>
      {detail && <span className="text-[10.5px] text-ink-45 block mt-0.5">{detail}</span>}
    </div>
  );
}
