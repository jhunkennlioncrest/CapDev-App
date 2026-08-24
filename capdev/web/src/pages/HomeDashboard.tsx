import { useCallback, useEffect, useState } from "react";
import { RiskSection } from "@/pages/RiskSection";
import { CalibrationAccuracySection } from "@/pages/CalibrationAccuracySection";
import { RepPerformanceSummary } from "@/pages/RepPerformanceSummary";
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
import { formatDate } from "@/lib/format";
import type { Session } from "@/lib/types";
import type { Workspace } from "@/components/AppShell";

interface Counts {
  pendingRaw: number;
  waitingCalibration: number;
  completedToday: number;
  /** How many completed evaluations the representative figure is drawn from. */
  completedEvaluations: number;
  moments: number;
  averageScore: number | null;
  recent: { id: string; title: string; when: string; what: string }[];
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
  onOpenCall,
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

    const today = new Date().toDateString();
    const stats = statsFrom(repo);

    setCounts({
      pendingRaw: raw.length,
      waitingCalibration: queue.filter((q) => q.status === "waiting").length,
      completedToday: repo.filter(
        (r) => r.submitted_at && new Date(r.submitted_at).toDateString() === today,
      ).length,
      completedEvaluations: stats.completed,
      moments: moments.count ?? 0,
      averageScore: stats.averageScore,
      recent: repo.slice(0, 6).map((r) => ({
        id: r.call_id,
        title: r.call_title,
        when: r.submitted_at ? formatDate(r.submitted_at) : "",
        what: `${r.overall_score ?? "—"}% · calibrated by ${r.trainer_name ?? "—"}`,
      })),
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
                silently showed before. */}
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

          {/* Separate again from both scoring and calibration accuracy: this
              asks what needs attention, not how anyone performed. */}
          <RiskSection session={session} />

          {/* Named for what the role actually did: a reviewer observes, a
              trainer calibrates. The old shared "Recent evaluations" implied
              the reviewer owned the representative's final score. */}
          {canCalibrate ? (
            <section className="mt-7">
              <h2 className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-2.5">
                Recent calibrations
              </h2>
              {(trainer?.recent.length ?? 0) === 0 ? (
                <p className="text-[13px] text-ink-45 border border-dashed border-rule rounded px-4 py-4">
                  No calibrations completed yet.
                </p>
              ) : (
                <ul className="bg-card border border-rule-soft rounded divide-y divide-rule-soft">
                  {trainer?.recent.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => onNavigate(canCalibrate ? "calibration" : "rawqa")}
                        className="w-full text-left px-4 py-2.5 flex justify-between items-baseline gap-3 hover:bg-ground"
                      >
                        <span className="text-[13.5px] min-w-0 truncate">
                          {r.representative_name ?? r.call_title}
                        </span>
                        <span className="text-[12px] text-ink-45 shrink-0">
                          {r.score === null ? "—" : `${r.score}%`}
                          {" · "}
                          {r.disagreements === 0
                            ? "no disagreements"
                            : `${r.disagreements} disagreement${r.disagreements === 1 ? "" : "s"}`}
                          {" · "}
                          {formatDate(r.submitted_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <section className="mt-7">
              <h2 className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-2.5">
                Recent observations
              </h2>
              {(mine?.recent.length ?? 0) === 0 ? (
                <p className="text-[13px] text-ink-45 border border-dashed border-rule rounded px-4 py-4">
                  No observations submitted yet.
                </p>
              ) : (
                <ul className="bg-card border border-rule-soft rounded divide-y divide-rule-soft">
                  {mine?.recent.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => onNavigate(canCalibrate ? "calibration" : "rawqa")}
                        className="w-full text-left px-4 py-2.5 flex justify-between items-baseline gap-3 hover:bg-ground"
                      >
                        <span className="text-[13.5px] min-w-0 truncate">
                          {r.representative_name ?? r.call_title}
                        </span>
                        <span className="text-[12px] text-ink-45 shrink-0">
                          {/* No score here: the reviewer does not own the
                              representative's result. */}
                          {r.calibrated ? "calibrated" : "awaiting calibration"}
                          {" · "}
                          {formatDate(r.submitted_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
      {/* Rep performance summarises completed work. Trainers and managers
          only: a reviewer making objective observations should not be
          weighing historical performance at the same time. */}
      {onOpenRepPerformance &&
        (session.permissions.includes("calibration.perform") ||
          session.permissions.includes("organization.manage")) && (
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
