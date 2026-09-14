import { useCallback, useEffect, useState } from "react";
import { ExecutiveReport } from "@/pages/ExecutiveReport";
import { RepresentativeReport } from "@/pages/RepresentativeReport";
import { ReportPage, ReportProblem, ReportToolbar } from "@/components/report";
import { PeriodSelect } from "@/components/dash";
import { availablePeriods } from "@/lib/dashboard";
import {
  allTimePeriod,
  periodKey,
  periodLabel,
  type Period,
} from "@/lib/period";
import { pushReport, replaceReport, type ReportRequest } from "@/lib/reportState";
import type { Session } from "@/lib/types";

/**
 * The shell a report is read in (0079).
 *
 * Everything that is NOT the document lives here: the screen-only toolbar, the
 * period control, the permission gate and the failure states. The document
 * bodies below know nothing about navigation, which is why they print cleanly —
 * there is no button inside them to hide.
 *
 * THE PERIOD CONTROL IS NOT A SECOND PERIOD STATE. It writes to the URL, which
 * is where an open report's period already lives, and the change arrives back
 * through the same prop the report was opened with. There is one value, in one
 * place; the select is a way of editing it, not a copy of it.
 */
export function ReportView({
  session,
  request,
  onExit,
  onRequestChange,
}: {
  session: Session;
  request: ReportRequest;
  onExit: () => void;
  onRequestChange: (next: ReportRequest) => void;
}): JSX.Element {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [missing, setMissing] = useState<string | null>(null);

  // Reading performance is the same boundary the Dashboard enforces. A report
  // is a presentation of data the reader can already reach, never a way in.
  const canSeePerformance = session.permissions.includes("evaluation.read");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const options = await availablePeriods();
      if (cancelled) return;
      const seen = new Set<string>();
      const deduped: Period[] = [];
      for (const p of [allTimePeriod(), ...options, request.period]) {
        const key = periodKey(p);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(p);
      }
      setPeriods(deduped);
    })();
    return () => {
      cancelled = true;
    };
    // The selected period is included so a report opened on a month outside the
    // usual span still shows that month in the control rather than silently
    // falling back to another one.
  }, [request.period]);

  useEffect(() => {
    setMissing(null);
  }, [request]);

  const openRepresentative = useCallback(
    (repId: string) => {
      const next: ReportRequest = { kind: "representative", repId, period: request.period };
      pushReport(next);
      onRequestChange(next);
    },
    [request.period, onRequestChange],
  );

  const changePeriod = useCallback(
    (key: string) => {
      const next = periods.find((p) => periodKey(p) === key);
      if (next === undefined) return;
      const updated: ReportRequest =
        request.kind === "executive"
          ? { kind: "executive", period: next }
          : { kind: "representative", repId: request.repId, period: next };
      // Replace, not push: changing the period three times while reading one
      // report should not cost three Back presses to leave it.
      replaceReport(updated);
      onRequestChange(updated);
    },
    [periods, request, onRequestChange],
  );

  if (!canSeePerformance) {
    return (
      <ReportProblem
        title="Report not available"
        detail="Performance reporting is not available for your role."
        onBack={onExit}
      />
    );
  }

  if (missing !== null) {
    return <ReportProblem title="Report not available" detail={missing} onBack={onExit} />;
  }

  const options = periods.length > 0 ? periods : [request.period];

  return (
    <ReportPage>
      <ReportToolbar onBack={onExit} onPrint={() => window.print()}>
        <PeriodSelect
          value={periodKey(request.period)}
          options={options.map(periodKey)}
          onChange={changePeriod}
          labelOf={(key) => {
            const p = options.find((o) => periodKey(o) === key);
            return p ? periodLabel(p) : key;
          }}
        />
      </ReportToolbar>

      <div className="report-sheet mx-auto">
        {request.kind === "executive" ? (
          <ExecutiveReport
            session={session}
            period={request.period}
            onOpenRepresentative={openRepresentative}
          />
        ) : (
          <RepresentativeReport
            repId={request.repId}
            period={request.period}
            onMissing={setMissing}
          />
        )}
      </div>
    </ReportPage>
  );
}
