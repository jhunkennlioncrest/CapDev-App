import { useCallback, useEffect, useState } from "react";
import { RiskSection } from "@/pages/RiskSection";
import { CalibrationAccuracySection } from "@/pages/CalibrationAccuracySection";
import { RepPerformanceSummary } from "@/pages/RepPerformanceSummary";
import { getQueue } from "@/lib/evaluation";
import { getRawWorklist } from "@/lib/workflow";
import { listRepository, statsFrom } from "@/lib/repository";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/format";
import type { Session } from "@/lib/types";
import type { Workspace } from "@/components/AppShell";

interface Counts {
  pendingRaw: number;
  waitingCalibration: number;
  completedToday: number;
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
  onOpenRepPerformance,
}: {
  session: Session;
  onNavigate: (w: Workspace) => void;
  /** Rep performance lives under the Dashboard, not as its own workspace. */
  onOpenRepPerformance?: (repId?: string) => void;
}): JSX.Element {
  const [counts, setCounts] = useState<Counts | null>(null);
  const canReview = session.permissions.includes("raw_qa.submit");
  const canCalibrate = session.permissions.includes("calibration.perform");

  const load = useCallback(async (): Promise<void> => {
    const [raw, queue, repo, moments] = await Promise.all([
      canReview ? getRawWorklist() : Promise.resolve([]),
      canCalibrate ? getQueue() : Promise.resolve([]),
      listRepository(),
      supabase.from("moment").select("id", { count: "exact", head: true }).is("archived_at", null),
    ]);

    const today = new Date().toDateString();
    const stats = statsFrom(repo);

    setCounts({
      pendingRaw: raw.length,
      waitingCalibration: queue.filter((q) => q.status === "waiting").length,
      completedToday: repo.filter(
        (r) => r.submitted_at && new Date(r.submitted_at).toDateString() === today,
      ).length,
      moments: moments.count ?? 0,
      averageScore: stats.averageScore,
      recent: repo.slice(0, 6).map((r) => ({
        id: r.call_id,
        title: r.call_title,
        when: r.submitted_at ? formatDate(r.submitted_at) : "",
        what: `${r.overall_score ?? "—"}% · calibrated by ${r.trainer_name ?? "—"}`,
      })),
    });
  }, [canReview, canCalibrate]);

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
            <Card
              value={counts.completedToday}
              label="completed today"
              action="See the library"
              onClick={() => onNavigate("library")}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 border-y border-rule mt-7">
            <Figure
              value={counts.averageScore === null ? "—" : `${counts.averageScore}%`}
              caption="average score"
            />
            <Figure value={String(counts.moments)} caption="teaching moments" />
            <Figure
              value={String(counts.recent.length)}
              caption="recent evaluations"
            />
          </div>

          {/* A different question from "average score" above: that is the
              representative's result, this is how closely the reviewer's
              observations matched the trainer's final decisions. */}
          <CalibrationAccuracySection session={session} />

          {/* Separate again from both scoring and calibration accuracy: this
              asks what needs attention, not how anyone performed. */}
          <RiskSection session={session} />

          {counts.recent.length > 0 && (
            <section className="mt-7">
              <h2 className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-2.5">
                Recent activity
              </h2>
              <ul className="bg-card border border-rule-soft rounded divide-y divide-rule-soft">
                {counts.recent.map((r) => (
                  <li key={r.id} className="px-4 py-2.5 flex justify-between items-baseline gap-3">
                    <span className="text-[13.5px] min-w-0">{r.title}</span>
                    <span className="text-[12px] text-ink-45 shrink-0">
                      {r.what} · {r.when}
                    </span>
                  </li>
                ))}
              </ul>
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

function Figure({ value, caption }: { value: string; caption: string }): JSX.Element {
  return (
    <div className="py-4 pr-5 border-r border-rule-soft last:border-r-0">
      <span className="font-display text-2xl block leading-none mb-1">{value}</span>
      <span className="text-[11.5px] text-ink-45">{caption}</span>
    </div>
  );
}
