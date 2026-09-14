import { useEffect, useState } from "react";
import {
  sharedPerformanceWithComparison,
  comparePercent,
  compareCount,
  compareStage,
  stageComparability,
  LOW_SAMPLE,
  type PerformanceComparison,
  type StageFigure,
} from "@/lib/dashboard";
import {
  repPerformanceForPeriod,
  calibratedTrends,
  calibrationHotspotsForPeriod,
  formatPercent,
  formatGap,
  scoreGap,
  type RepPeriodResult,
  type RepTrend,
  type CalibrationHotspotResult,
} from "@/lib/performance";
import { listVersions } from "@/lib/rubricAdmin";
import { comparisonText, stageNoteText } from "@/lib/comparisonText";
import { periodLabel, periodSentence, type Period } from "@/lib/period";
import { formatDate } from "@/lib/format";
import {
  ReportFigure,
  ReportFigureGrid,
  ReportFooter,
  ReportMasthead,
  ReportNote,
  ReportPanel,
  ReportSection,
  ReportTable,
  type ScopeEntry,
} from "@/components/report";
import type { Session } from "@/lib/types";

/**
 * The Executive Performance Report (0079).
 *
 * SAME TRUTH, DIFFERENT PRESENTATION — and that is a claim this file has to
 * earn, not assert. Every number below arrives from the accepted 0078 helpers:
 * sharedPerformanceWithComparison for the department, repPerformanceForPeriod
 * for the roster, calibrationHotspotsForPeriod for the criteria,
 * calibratedTrends for the Trend column. Nothing is recomputed here, nothing is
 * rounded here, and the comparison sentences come from the same module the
 * Dashboard prints. If the Dashboard says 61.9%, this says 61.9% because it is
 * the same call, not because the same formula was written out twice.
 *
 * WHAT IS DELIBERATELY ABSENT: any interpretation. No strengths, no
 * opportunities, no highest or lowest stage, no coaching line. The stage table
 * carries percentage, met, missed, N/A and the contributing evaluation count —
 * the evidence — and the reader draws the conclusion. Converting a percentage
 * into a judgement needs business rules CapDev has not defined, and a
 * sample-size threshold does not define them (0079 scope decision).
 */
export function ExecutiveReport({
  session,
  period,
  onOpenRepresentative,
}: {
  session: Session;
  period: Period;
  /** Back and Print belong to the report shell, not to the document body. */
  onOpenRepresentative: (repId: string) => void;
}): JSX.Element {
  const [comp, setComp] = useState<PerformanceComparison | null>(null);
  const [reps, setReps] = useState<RepPeriodResult | null>(null);
  const [trends, setTrends] = useState<Record<string, RepTrend>>({});
  const [hotspots, setHotspots] = useState<CalibrationHotspotResult | null>(null);
  const [failed, setFailed] = useState(false);

  // The same boundary the application enforces, evaluated before the read is
  // issued. A report is not a way around a permission.
  const canSeeCriteria = session.permissions.includes("calibration.perform");

  useEffect(() => {
    let cancelled = false;
    setComp(null);
    setReps(null);
    setFailed(false);
    void (async () => {
      try {
        const [performance, roster, versions] = await Promise.all([
          sharedPerformanceWithComparison(period),
          repPerformanceForPeriod(period),
          listVersions(),
        ]);
        if (cancelled) return;
        setComp(performance);
        setReps(roster);

        const active = versions.find((v) => v.status === "active");
        if (active && roster.rows.length > 0) {
          const t = await calibratedTrends(
            roster.rows.map((r) => r.representative_id),
            active.id,
          );
          if (!cancelled) setTrends(t);
        } else if (!cancelled) {
          setTrends({});
        }

        if (canSeeCriteria) {
          try {
            const h = await calibrationHotspotsForPeriod(period);
            if (!cancelled) setHotspots(h);
          } catch {
            // One unreadable section degrades that section, not the report.
            if (!cancelled) setHotspots(null);
          }
        } else if (!cancelled) {
          setHotspots(null);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period, canSeeCriteria]);

  if (failed) {
    return (
      <ReportSection title="Report unavailable">
        <ReportNote>
          The performance figures for this period could not be read. Nothing was
          reported rather than reporting a figure that may be wrong.
        </ReportNote>
      </ReportSection>
    );
  }
  if (comp === null || reps === null) {
    return <p className="text-ink-45 text-sm pt-10">Preparing report&hellip;</p>;
  }

  const data = comp.current;
  const dis = data.disagreements;
  const nn = data.nonNegotiables;
  const stageGate = stageComparability(comp);
  const stageNote = stageNoteText(stageGate, period);

  const movement = (c: Parameters<typeof comparisonText>[0]): string | undefined =>
    comparisonText(c, period, comp.previousPeriod)?.text;

  const scope: ScopeEntry[] = [
    { label: "Reporting period", value: periodLabel(period) },
    {
      label: "Rubric versions represented",
      value:
        data.rubricLabels.length === 0
          ? "No assessments in this period"
          : data.rubricLabels.map((l) => `v${l}`).join(", "),
    },
    {
      label: "Observed",
      value: `${data.observedCount} Raw QA observation${data.observedCount === 1 ? "" : "s"}`,
    },
    {
      label: "Evaluated",
      value: `${data.evaluatedCount} calibrated evaluation${data.evaluatedCount === 1 ? "" : "s"}`,
    },
    { label: "Generated from", value: "CapDev" },
    { label: "Generated", value: formatDate(new Date().toISOString()) },
  ];

  return (
    <>
      <ReportMasthead title="Executive Performance Report" scope={scope} />

      <ReportSection title="Report summary">
        <p className="text-[12.5px] text-ink-70 leading-relaxed">{periodSentence(period)}.</p>
        <ReportNote>
          Figures are the CapDev measurements for the reporting period above.
          Observed Score and Calibrated Score are means of the individual
          assessment scores; stage percentages pool criteria met over criteria
          assessed, with N/A excluded.
        </ReportNote>
      </ReportSection>

      <ReportSection title="Team performance">
        <ReportFigureGrid>
          <ReportFigure
            label="Observed"
            value={String(data.observedCount)}
            movement={movement(compareCount(comp, (p) => p.observedCount))}
            detail="Submitted Raw QA observations"
          />
          <ReportFigure
            label="Evaluated"
            value={String(data.evaluatedCount)}
            movement={movement(compareCount(comp, (p) => p.evaluatedCount))}
            detail="Submitted calibrated evaluations"
          />
          <ReportFigure
            label="Observed Score"
            value={formatPercent(data.observedPct)}
            movement={movement(comparePercent(comp, (p) => p.observedPct))}
            detail="Mean submitted Raw QA observation score"
          />
          <ReportFigure
            label="Calibrated Score"
            value={formatPercent(data.evaluatedPct)}
            movement={movement(comparePercent(comp, (p) => p.evaluatedPct))}
            detail="Mean calibrated evaluation score"
          />
          <ReportFigure
            label="Non-Negotiables"
            value={nn === null ? "—" : formatPercent(nn.pct)}
            movement={movement(comparePercent(comp, (p) => p.nonNegotiables?.pct ?? null))}
            detail={
              nn === null
                ? "No results in this period"
                : `${nn.passed} of ${nn.n} evaluation${nn.n === 1 ? "" : "s"} passed`
            }
          />
          <ReportFigure
            label="Disagreements"
            value={dis === null || dis.pct === null ? "—" : formatPercent(dis.pct)}
            movement={movement(comparePercent(comp, (p) => p.disagreements?.pct ?? null))}
            detail={
              dis === null
                ? "Restricted for your role"
                : dis.comparisons === 0
                  ? "No comparisons in this period"
                  : `${dis.misaligned} of ${dis.comparisons} criterion comparisons`
            }
          />
        </ReportFigureGrid>
      </ReportSection>

      {/* Stage performance. Non-Negotiables is NOT in this table — it is a pass
          rate over whole evaluations, not a ratio of criteria, and a sixth row
          here would invite it to be read and averaged as a stage. */}
      {data.stageGroups ? (
        data.stageGroups.map((g) => (
          <ReportSection
            key={g.versionId}
            title={`Stage performance · rubric v${g.versionLabel}`}
            note={`${g.evaluations} ${g.evaluations === 1 ? "evaluation" : "evaluations"}${
              stageNote === null ? "" : ` · ${stageNote}`
            }`}
          >
            <StageTable stages={g.stages} movementFor={() => undefined} />
          </ReportSection>
        ))
      ) : (
        <ReportSection
          title="Stage performance"
          note={stageNote === null ? "Calibrated rubric criteria" : stageNote}
        >
          <StageTable
            stages={data.stages}
            movementFor={(key) => (stageNote === null ? movement(compareStage(comp, key)) : undefined)}
          />
        </ReportSection>
      )}

      <ReportSection title="Non-Negotiables">
        <ReportPanel title="Pass rate over whole evaluations">
          <p className="report-figure-value">{nn === null ? "—" : formatPercent(nn.pct)}</p>
          {(() => {
            const text = movement(comparePercent(comp, (p) => p.nonNegotiables?.pct ?? null));
            return text === undefined ? null : <p className="report-figure-movement">{text}</p>;
          })()}
          <p className="report-figure-detail">
            {nn === null
              ? "No calibrated evaluation in this period carries a Non-Negotiables result."
              : `${nn.passed} of ${nn.n} calibrated evaluation${
                  nn.n === 1 ? "" : "s"
                } passed every Non-Negotiable.`}
          </p>
        </ReportPanel>
        <ReportNote>
          Not a stage. A pass rate over whole evaluations, reported separately so
          it is never averaged with the criterion ratios above.
        </ReportNote>
      </ReportSection>

      <ReportSection title="QA calibration · reviewer alignment">
        <ReportPanel title="Department disagreement">
          <p className="report-figure-value">
            {dis === null || dis.pct === null ? "—" : formatPercent(dis.pct)}
          </p>
          <p className="report-figure-detail">
            {dis === null
              ? "Restricted for your role."
              : dis.comparisons === 0
                ? "No criterion comparisons in this period."
                : `${dis.misaligned} of ${dis.comparisons} criterion comparisons between Raw QA and the Trainer.`}
          </p>
        </ReportPanel>

        {!canSeeCriteria ? (
          <ReportNote>
            Criterion-level disagreement detail is restricted for your role and is
            not included in this report.
          </ReportNote>
        ) : hotspots === null ? (
          <ReportNote>Criterion-level disagreement detail could not be read.</ReportNote>
        ) : hotspots.comparisons === 0 ? (
          <ReportNote>No criterion comparisons were recorded in this period.</ReportNote>
        ) : hotspots.rows.length === 0 ? (
          <ReportNote>
            No disagreements were recorded in this period — {hotspots.comparisons} criterion
            comparisons, and Raw QA and the Trainer agreed on every one.
          </ReportNote>
        ) : (
          <div className="mt-3">
            <ReportTable
              caption="Most disagreed criteria"
              columns={[
                { key: "code", head: "Code" },
                { key: "label", head: "Criterion" },
                { key: "dis", head: "Disagreed", numeric: true },
                { key: "compared", head: "Compared", numeric: true },
                { key: "rate", head: "Rate", numeric: true },
              ]}
            >
              {hotspots.rows.map((row) => (
                <tr key={row.criterion_id}>
                  <td>{row.criterion_code}</td>
                  <td>
                    {row.criterion_label}
                    {hotspots.versions.length > 1 && row.version_label !== null && (
                      <span className="muted"> · v{row.version_label}</span>
                    )}
                  </td>
                  <td className="num">{row.disagreements}</td>
                  <td className="num">{row.compared}</td>
                  <td className="num">{formatPercent(row.disagreement_rate)}</td>
                </tr>
              ))}
            </ReportTable>
          </div>
        )}
      </ReportSection>

      <ReportSection title="Representative performance" note={periodLabel(period)}>
        {reps.rows.length === 0 ? (
          <ReportNote>No representative was assessed in this period.</ReportNote>
        ) : (
          <ReportTable
            columns={[
              { key: "name", head: "Representative" },
              { key: "raw", head: "Raw QA", numeric: true },
              { key: "trainer", head: "Trainer", numeric: true },
              { key: "gap", head: "Gap", numeric: true },
              { key: "prev", head: "Previous", numeric: true },
              { key: "cur", head: "Current", numeric: true },
              { key: "trend", head: "Trend" },
            ]}
          >
            {reps.rows.map((r) => {
              const trend = trends[r.representative_id];
              return (
                <tr key={r.representative_id}>
                  <td>
                    <button
                      type="button"
                      onClick={() => onOpenRepresentative(r.representative_id)}
                      className="print:no-underline underline underline-offset-2 text-left"
                    >
                      {r.representative_name}
                    </button>
                    {r.is_inactive && <span className="muted"> · {r.status}</span>}
                  </td>
                  <td className="num">{formatPercent(r.observedPct)}</td>
                  <td className="num">{formatPercent(r.calibratedPct)}</td>
                  <td className="num">{formatGap(scoreGap(r.observedPct, r.calibratedPct))}</td>
                  <td className="num">{formatPercent(trend?.previous ?? null)}</td>
                  <td className="num">{formatPercent(trend?.current ?? null)}</td>
                  <td>{trendWord(trend)}</td>
                </tr>
              );
            })}
          </ReportTable>
        )}
        {reps.withoutAssessments > 0 && (
          <ReportNote>
            {reps.withoutAssessments}{" "}
            {reps.withoutAssessments === 1 ? "representative" : "representatives"}{" "}
            {period.kind === "all"
              ? "have not been assessed yet."
              : `had no assessments in ${periodLabel(period)}.`}
          </ReportNote>
        )}
        <ReportNote>
          Previous, Current and Trend compare a representative&rsquo;s latest
          calibrated evaluation with the one immediately before it, whenever those
          happened. They are evaluation history, not a comparison between calendar
          months.
        </ReportNote>
      </ReportSection>

      <ReportFooter />
    </>
  );
}

/**
 * One stage table. Percentage, the criterion outcomes it is made of, the
 * evaluation sample, and the movement — the evidence, with no verdict attached.
 */
function StageTable({
  stages,
  movementFor,
}: {
  stages: StageFigure[];
  movementFor: (key: string) => string | undefined;
}): JSX.Element {
  return (
    <ReportTable
      columns={[
        { key: "stage", head: "Stage" },
        { key: "pct", head: "Result", numeric: true },
        { key: "met", head: "Met", numeric: true },
        { key: "missed", head: "Missed", numeric: true },
        { key: "na", head: "N/A", numeric: true },
        { key: "n", head: "Evaluations", numeric: true },
        { key: "delta", head: "Movement", numeric: true },
      ]}
    >
      {stages.map((s) => {
        const move = movementFor(s.key);
        return (
          <tr key={s.key}>
            <td>
              {s.label}
              {s.touched > 0 && s.pct === null && (
                <span className="muted"> · no applicable criteria</span>
              )}
              {s.pct !== null && s.n > 0 && s.n < LOW_SAMPLE && (
                <span className="muted"> · limited data</span>
              )}
            </td>
            <td className="num">{formatPercent(s.pct)}</td>
            <td className="num">{s.met}</td>
            <td className="num">{s.missed}</td>
            <td className="num">{s.na}</td>
            <td className="num">{s.touched === 0 ? "—" : s.n}</td>
            <td className="num">{move ?? "—"}</td>
          </tr>
        );
      })}
    </ReportTable>
  );
}

/** The Trend word, spelled out — an arrow does not survive a photocopier. */
function trendWord(trend: RepTrend | undefined): string {
  if (trend === undefined) return "—";
  switch (trend.direction) {
    case "up":
      return "Improving";
    case "down":
      return "Declining";
    case "flat":
      return "Stable";
    case "baseline":
      return "Baseline";
    case "none":
      return "—";
  }
}
