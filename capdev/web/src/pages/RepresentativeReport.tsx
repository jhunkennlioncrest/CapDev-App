import { useEffect, useState } from "react";
import {
  stagePerformanceFor,
  nonNegotiablesFrom,
  assessmentScore,
  LOW_SAMPLE,
  type StageFigure,
} from "@/lib/dashboard";
import {
  repPerformanceForPeriod,
  listRepresentatives,
  calibratedTrends,
  formatPercent,
  formatGap,
  scoreGap,
  type RepPeriodRow,
  type RepPeriodAssessment,
  type RepTrend,
} from "@/lib/performance";
import { listVersions } from "@/lib/rubricAdmin";
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

/**
 * The Individual Representative Performance Report (0079).
 *
 * BUILT FROM THE ROSTER HELPER, NOT A PER-PERSON QUERY. The summary figures come
 * from repPerformanceForPeriod() — the same call the Dashboard's representative
 * table makes — and this file simply selects the one row. That is deliberate and
 * slightly wasteful: it reads the whole roster to report on one person. The
 * alternative is a per-representative query with its own filters, which is
 * exactly how a report comes to disagree with the table it was opened from. At
 * this volume the cost is nothing and the guarantee is absolute: if the table
 * says 94.7%, this says 94.7%, because it is the same number.
 *
 * The stage figures narrow the SAME pooled primitive the department uses, via
 * stagePerformanceFor(), scoped to the calibrated evaluations that row counted.
 *
 * NO INTERPRETATION. No strengths, no opportunities, no highest or lowest stage,
 * no coaching line — deferred by the 0079 scope decision until CapDev has both
 * enough history and agreed rules for what a stage percentage means. The
 * evidence is here; the judgement is the reader's.
 */
export function RepresentativeReport({
  repId,
  period,
  onMissing,
}: {
  repId: string;
  period: Period;
  /** Called when the id names no representative, so the shell can say so. */
  onMissing: (reason: string) => void;
}): JSX.Element {
  const [name, setName] = useState<string | null>(null);
  const [row, setRow] = useState<RepPeriodRow | null>(null);
  const [stages, setStages] = useState<StageFigure[] | null>(null);
  const [trend, setTrend] = useState<RepTrend | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setName(null);
    setRow(null);
    setStages(null);
    setFailed(false);
    void (async () => {
      try {
        const [directory, roster, versions] = await Promise.all([
          listRepresentatives(),
          repPerformanceForPeriod(period),
          listVersions(),
        ]);
        if (cancelled) return;

        const person = directory.find((r) => r.id === repId);
        if (person === undefined) {
          // Never substitute a different representative. The reader asked for
          // this one; if the application cannot find them, it says so.
          onMissing("That representative could not be found, or is not visible to your role.");
          return;
        }
        setName(person.display_name);

        const found = roster.rows.find((r) => r.representative_id === repId) ?? null;
        setRow(found);

        const calibratedIds = (found?.assessments ?? [])
          .filter((a) => a.kind === "calibrated")
          .map((a) => a.id);
        setStages(await stagePerformanceFor(calibratedIds));

        const active = versions.find((v) => v.status === "active");
        if (active) {
          const trends = await calibratedTrends([repId], active.id);
          if (!cancelled) setTrend(trends[repId] ?? null);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repId, period, onMissing]);

  if (failed) {
    return (
      <ReportSection title="Report unavailable">
        <ReportNote>
          This representative&rsquo;s figures could not be read. Nothing was
          reported rather than reporting a figure that may be wrong.
        </ReportNote>
      </ReportSection>
    );
  }
  if (name === null || stages === null) {
    return <p className="text-ink-45 text-sm pt-10">Preparing report&hellip;</p>;
  }

  const calibrated = (row?.assessments ?? []).filter((a) => a.kind === "calibrated");
  const nn = nonNegotiablesFrom(calibrated);
  const gap = scoreGap(row?.observedPct ?? null, row?.calibratedPct ?? null);

  const scope: ScopeEntry[] = [
    { label: "Reporting period", value: periodLabel(period) },
    {
      label: "Observed",
      value: `${row?.observations ?? 0} Raw QA observation${(row?.observations ?? 0) === 1 ? "" : "s"}`,
    },
    {
      label: "Evaluated",
      value: `${row?.evaluations ?? 0} calibrated evaluation${(row?.evaluations ?? 0) === 1 ? "" : "s"}`,
    },
    { label: "Generated from", value: "CapDev" },
    { label: "Generated", value: formatDate(new Date().toISOString()) },
  ];

  return (
    <>
      <ReportMasthead
        title="Representative Performance Report"
        subject={name}
        scope={scope}
      />

      <ReportSection title="Report summary">
        <p className="text-[12.5px] text-ink-70 leading-relaxed">{periodSentence(period)}.</p>
        {row === null && (
          <ReportNote>
            {name} has no submitted assessments in this period. The sections below
            are empty for that reason, not because a figure could not be read.
          </ReportNote>
        )}
      </ReportSection>

      <ReportSection title="Performance summary">
        <ReportFigureGrid>
          <ReportFigure
            label="Raw QA / Observed Score"
            value={formatPercent(row?.observedPct ?? null)}
            detail={`Mean of ${row?.observations ?? 0} submitted Raw QA observation${
              (row?.observations ?? 0) === 1 ? "" : "s"
            }`}
          />
          <ReportFigure
            label="Trainer / Calibrated Score"
            value={formatPercent(row?.calibratedPct ?? null)}
            detail={`Mean of ${row?.evaluations ?? 0} calibrated evaluation${
              (row?.evaluations ?? 0) === 1 ? "" : "s"
            }`}
          />
          <ReportFigure
            label="Gap"
            value={formatGap(gap)}
            detail="Trainer minus Raw QA, in percentage points. Shown only when both sides exist."
          />
        </ReportFigureGrid>
      </ReportSection>

      <ReportSection title="Trend" note="Evaluation history">
        <ReportFigureGrid columns={2}>
          <ReportFigure
            label="Previous calibrated evaluation"
            value={formatPercent(trend?.previous ?? null)}
          />
          <ReportFigure
            label="Latest calibrated evaluation"
            value={formatPercent(trend?.current ?? null)}
            movement={
              trend?.delta === null || trend?.delta === undefined
                ? undefined
                : formatGap(trend.delta)
            }
          />
        </ReportFigureGrid>
        <ReportNote>
          Trend compares the latest calibrated evaluation with the immediately
          previous calibrated evaluation, whenever those happened. It is
          evaluation history and is <em>not</em> a comparison between calendar
          months, so it is unaffected by the reporting period above.
          {trend?.direction === "baseline" && " There is only one calibrated evaluation, so no direction is claimed."}
        </ReportNote>
      </ReportSection>

      <ReportSection title="Stage performance" note="Calibrated rubric criteria">
        <ReportTable
          columns={[
            { key: "stage", head: "Stage" },
            { key: "pct", head: "Result", numeric: true },
            { key: "met", head: "Met", numeric: true },
            { key: "missed", head: "Missed", numeric: true },
            { key: "na", head: "N/A", numeric: true },
            { key: "n", head: "Calibrations", numeric: true },
          ]}
        >
          {stages.map((s) => (
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
            </tr>
          ))}
        </ReportTable>
        <ReportNote>
          Criteria met over criteria assessed, pooled across this
          representative&rsquo;s calibrated evaluations in the period. N/A is
          excluded from both sides of the ratio — a question that did not apply is
          not a miss. &ldquo;Limited data&rdquo; marks a stage measured from fewer
          than {LOW_SAMPLE} evaluations.
        </ReportNote>
      </ReportSection>

      <ReportSection title="Non-Negotiables">
        <ReportPanel title="Pass rate over whole evaluations">
          <p className="report-figure-value">{nn === null ? "—" : formatPercent(nn.pct)}</p>
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

      <ReportSection title="Assessment history" note={periodLabel(period)}>
        {calibrated.length === 0 && (row?.assessments.length ?? 0) === 0 ? (
          <ReportNote>No assessments were submitted in this period.</ReportNote>
        ) : (
          <ReportTable
            columns={[
              { key: "date", head: "Submitted" },
              { key: "type", head: "Assessment" },
              { key: "score", head: "Score", numeric: true },
            ]}
          >
            {(row?.assessments ?? []).map((a) => (
              <tr key={a.id}>
                <td>{formatDate(a.submitted_at)}</td>
                <td>{assessmentTypeLabel(a)}</td>
                <td className="num">{formatPercent(assessmentScore(a))}</td>
              </tr>
            ))}
          </ReportTable>
        )}
        <ReportNote>
          The assessments the figures above were computed from. Individual
          criterion responses are not reproduced here — they remain available in
          CapDev against each assessment.
        </ReportNote>
      </ReportSection>

      <ReportFooter />
    </>
  );
}

function assessmentTypeLabel(a: RepPeriodAssessment): string {
  return a.kind === "calibrated" ? "Calibrated evaluation" : "Raw QA observation";
}
