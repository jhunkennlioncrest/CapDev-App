import { useCallback, useEffect, useState } from "react";
import { CalibrationAccuracySection } from "@/pages/CalibrationAccuracySection";
import { RepPerformanceSummary } from "@/pages/RepPerformanceSummary";
import { PerformanceOverview } from "@/pages/PerformanceOverview";
import { SectionHeading, Icon } from "@/components/dash";
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

  const now = new Date();
  const today = now.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <header className="pt-10 pb-7 flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="font-display text-[32px] leading-tight">
            {greeting}, {session.person.display_name?.split(" ")[0] ?? "there"}
          </h1>
          <p className="text-[13px] text-ink-45 mt-1.5">
            Here&rsquo;s what&rsquo;s happening with your QA work and team
            performance.
          </p>
        </div>
        <p className="text-[12px] text-ink-45 pt-2">{today}</p>
      </header>

      {counts === null ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : (
        <>
          {/* Operational, and deliberately not the loudest thing on the page:
              these cards say what is queued for one person, while the sections
              below say how the department is doing. A role with no QA queue
              gets no heading at all rather than an empty one. */}
          {(canReview || canCalibrate) && <SectionHeading title="Your work" />}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {canReview && (
              <Card
                icon="inbox"
                value={counts.pendingRaw}
                label="Waiting for your review"
                action="Open Raw QA"
                onClick={() => onNavigate("rawqa")}
                emphasis={counts.pendingRaw > 0}
              />
            )}
            {canCalibrate && (
              <Card
                icon="scales"
                value={counts.waitingCalibration}
                label="Ready for calibration"
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
                icon="check"
                value={
                  canCalibrate
                    ? (trainer?.completedThisWeek ?? 0)
                    : (mine?.completedThisWeek ?? 0)
                }
                label={
                  canCalibrate
                    ? "Calibrations this week"
                    : "Observations this week"
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              {/* Renamed in the 0077 visual pass, and not for tidiness. This
                  is statsFrom().averageScore: the MEAN of per-evaluation
                  overall_score. Team performance's "Trainer performance" is a
                  different calculation — pooled criteria met over criteria
                  assessed — so the two can legitimately differ. Calling both
                  of them "representative performance" on one page, which is
                  what the old caption did, invited the reader to treat a
                  disagreement between them as an error. Neither number
                  changed; only this label. */}
              <Figure
                icon="clipboard"
                value={counts.averageScore === null ? "—" : `${counts.averageScore}%`}
                caption="Average evaluation score"
                detail={
                  counts.averageScore === null
                    ? "no completed evaluations yet"
                    : `mean of ${counts.completedEvaluations} completed evaluation${counts.completedEvaluations === 1 ? "" : "s"}`
                }
              />
              <Figure
                icon="bars"
                value={String(counts.moments)}
                caption="Active teaching moments"
                detail="in the Library"
              />
            </div>
          )}

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

      {/* A different question from the scores above: those are the
          representative's result, this is how closely a reviewer's observation
          matched the trainer's final decision. Moved below Team and Stage
          performance in the 0077 visual pass so the page reads personal work →
          department scores → alignment → people, rather than interrupting that
          order in the middle. */}
      <CalibrationAccuracySection session={session} />

      {canSeePerformance && onOpenRepPerformance && (
        <RepPerformanceSummary onOpen={onOpenRepPerformance} />
      )}

    </div>
  );
}

function Card({
  icon,
  value,
  label,
  action,
  onClick,
  emphasis = false,
}: {
  icon: "inbox" | "scales" | "check";
  value: number;
  label: string;
  action: string;
  onClick: () => void;
  emphasis?: boolean;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-card border rounded-lg px-5 py-4 hover:bg-ground-2 transition-colors ${
        emphasis ? "border-moss" : "border-rule-soft"
      }`}
    >
      <span className="flex items-start gap-3.5">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-ground-2 text-ink-45 shrink-0 mt-0.5">
          <Icon name={icon} />
        </span>
        <span className="block min-w-0">
          <span className="font-display text-[30px] block leading-none tabular-nums">
            {value}
          </span>
          <span className="text-[12.5px] text-ink-70 block mt-1.5">{label}</span>
          <span className="text-[12px] text-ink-45 block mt-2 underline underline-offset-2">
            {action} &rarr;
          </span>
        </span>
      </span>
    </button>
  );
}

function Figure({
  icon,
  value,
  caption,
  detail,
}: {
  icon: "clipboard" | "bars";
  value: string;
  caption: string;
  /** What the number covers. Every figure states its own scope. */
  detail?: string;
}): JSX.Element {
  return (
    <div className="bg-card border border-rule-soft rounded-lg px-5 py-4">
      <span className="flex items-center gap-2.5">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-ground-2 text-ink-45 shrink-0">
          <Icon name={icon} />
        </span>
        <span className="text-[12.5px] text-ink-70">{caption}</span>
      </span>
      <span className="font-display text-[26px] block leading-none mt-3 tabular-nums">
        {value}
      </span>
      {detail && <span className="text-[11.5px] text-ink-45 block mt-2">{detail}</span>}
    </div>
  );
}
