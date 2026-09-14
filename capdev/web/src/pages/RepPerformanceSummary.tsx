import { useEffect, useState } from "react";
import {
  listRepPerformance,
  listRepRawObservationPerformance,
  repPerformanceForPeriod,
  calibratedTrends,
  type RepTrend,
  formatGap,
  formatPercent,
  scoreGap,
} from "@/lib/performance";
import { listVersions } from "@/lib/rubricAdmin";
import { SectionHeading, TrendTag, Avatar, Toggle } from "@/components/dash";
import { periodLabel, type Period } from "@/lib/period";

/**
 * One row, whichever period produced it.
 *
 * All time and a month reach the same four figures by different routes — the
 * accepted aggregated views for all time, per-evaluation rows for a month,
 * because those views carry no date to filter on. Normalising here means the
 * markup below is written once and cannot drift between the two modes.
 */
interface Line {
  id: string;
  name: string;
  status: string;
  is_inactive: boolean;
  observations: number;
  evaluations: number;
  /** Raw QA figure for the period. */
  raw: number | null;
  /** Trainer (calibrated) figure for the period. */
  trainer: number | null;
}

/**
 * The compact Dashboard summary.
 *
 * Deliberately small: the Dashboard answers "how are we doing", and this is
 * the one line of that answer about people. Anything more belongs behind
 * "View rep performance".
 *
 * 0077 added the Raw QA column beside the Trainer one. The two are placed side
 * by side and never combined: they are separate assessments of the same call,
 * and a single blended figure would hide the very thing the comparison is for.
 * The Gap between them is in percentage POINTS, and is shown only when both
 * sides exist — a missing assessment is an em dash, never a zero, because a
 * zero would read as "they scored nothing" rather than "nobody looked yet".
 */
export function RepPerformanceSummary({
  onOpen,
  period,
}: {
  onOpen: (repId?: string) => void;
  /** The one selected period, owned by the page. */
  period: Period;
}): JSX.Element | null {
  const [rows, setRows] = useState<Line[] | null>(null);
  const [trends, setTrends] = useState<Record<string, RepTrend>>({});
  const [showInactive, setShowInactive] = useState(false);
  /** Representatives with nothing at all in the period. Monthly mode only. */
  const [quiet, setQuiet] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    void (async () => {
      const versions = await listVersions();
      const active = versions.find((v) => v.status === "active");

      let lines: Line[] = [];
      let without = 0;

      if (period.kind === "all") {
        // ALL TIME keeps the accepted 0077 path exactly: the aggregated views,
        // scoped to the active rubric, and the broader roster including
        // representatives not yet assessed.
        if (!active) {
          if (!cancelled) {
            setRows([]);
            setQuiet(0);
          }
          return;
        }
        const [all, raw] = await Promise.all([
          listRepPerformance(active.id),
          listRepRawObservationPerformance(active.id),
        ]);
        const rawById = new Map(
          raw.filter((r) => r.observations > 0).map((r) => [r.representative_id, r.score]),
        );
        lines = all.map((r) => ({
          id: r.representative_id,
          name: r.representative_name,
          status: r.status,
          is_inactive: r.is_inactive,
          observations: rawById.has(r.representative_id) ? 1 : 0,
          evaluations: r.evaluations,
          raw: rawById.get(r.representative_id) ?? null,
          trainer: r.score,
        }));
      } else {
        // A MONTH cannot come from those views: they are aggregated to
        // (representative x rubric version) and carry no date to filter on. The
        // monthly rollup reads the rows they are built from instead, and its
        // scores are MEANS of the individual assessments — the same arithmetic
        // as the Calibrated Score card, rather than the views' pooled ratio.
        const result = await repPerformanceForPeriod(period);
        without = result.withoutAssessments;
        lines = result.rows.map((r) => ({
          id: r.representative_id,
          name: r.representative_name,
          status: r.status,
          is_inactive: r.is_inactive,
          observations: r.observations,
          evaluations: r.evaluations,
          raw: r.observedPct,
          trainer: r.calibratedPct,
        }));
      }

      if (cancelled) return;
      setRows(lines);
      setQuiet(without);

      // Calibrated history for the roster. Deliberately NOT period-scoped: the
      // Trend column answers "is this representative improving against their
      // own last calibration", which is a different question from "how did
      // September go" and must not be quietly re-pointed at the period.
      const scored = lines.filter((r) => r.evaluations > 0);
      if (active && scored.length > 0) {
        const t = await calibratedTrends(scored.map((r) => r.id), active.id);
        if (!cancelled) setTrends(t);
      } else if (!cancelled) {
        setTrends({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period]);

  if (rows === null) return null;
  // All time with nothing in it stays hidden, as it has been since 0077. A
  // month with nothing in it does NOT hide: an empty September is an answer,
  // and a section that disappears reads as a section that failed.
  if (rows.length === 0 && period.kind === "all") return null;

  // Inactive representatives stay in the data — the detail view and their
  // history remain reachable — but a former employee is not a current concern,
  // so they are out of the default list.
  const visible = showInactive ? rows : rows.filter((r) => !r.is_inactive);
  const hiddenCount = rows.length - rows.filter((r) => !r.is_inactive).length;

  return (
    <section className="mt-8">
      <SectionHeading
        title="Representative performance"
        meta={periodLabel(period)}
      >
        {/* Only offered when something is actually hidden, so the control
            does not imply there are former representatives when there are
            none. */}
        {hiddenCount > 0 && (
          <Toggle
            on={showInactive}
            onChange={setShowInactive}
            label={`Show inactive (${hiddenCount})`}
          />
        )}
      </SectionHeading>

      {visible.length > 0 && (
      <div className="bg-card border border-rule-soft rounded-md overflow-hidden">
        {/* Wide: a management table. Column captions in the same quiet sans as
            everything else, one hairline under them, and no border around
            individual cells — the columns are already aligned, so ruling every
            box only adds noise. */}
        {/* Two groups, and the rule between them is the whole point. Raw QA,
            Trainer and Gap compare two ASSESSMENTS of the same calls. Previous,
            Current and Performance Trend compare the representative against
            THEMSELVES over time. Sitting in one undifferentiated row, Trend
            read as though it came out of the Gap; it never did. */}
        <div className="hidden sm:flex items-baseline gap-4 px-5 py-3 border-b border-rule-soft text-[11.5px] text-ink-45">
          <span className="w-7 shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">Representative</span>
          <span className="w-[4.5rem] text-right">Raw QA</span>
          <span className="w-[4.5rem] text-right">Trainer</span>
          <span className="w-[5rem] text-right">Gap</span>
          <span className="w-px self-stretch bg-rule-soft mx-1" aria-hidden="true" />
          <span className="w-[4.5rem] text-right" title="Previous calibrated score">
            Previous
          </span>
          <span className="w-[4.5rem] text-right" title="Current calibrated score">
            Current
          </span>
          <span
            className="w-[7rem]"
            title="The representative's own calibrated history — latest score against the one before it. Not scoped to the selected period."
          >
            Trend
          </span>
        </div>

        <ul className="divide-y divide-rule-soft">
          {visible.map((r) => {
            const t: RepTrend = trends[r.id] ??
              { previous: null, current: null, delta: null, direction: "none" };
            const rawScore = r.raw;
            const gap = scoreGap(rawScore, r.trainer);

            // One formatter for all four figures. They used to be printed
            // straight from their sources, which is why a single calibrated
            // evaluation could read 28.6% in the Trainer column and 28.57% in
            // Current — the same measurement wearing two faces.
            const rawText = formatPercent(rawScore);
            const trainerText = formatPercent(r.trainer);
            const rawTitle = rawScore === null
              ? period.kind === "all"
                ? "No submitted Raw QA observation"
                : `No submitted Raw QA observation in ${periodLabel(period)}`
              : period.kind === "all"
                ? "Raw QA: criteria met ÷ criteria assessed"
                : `Mean of ${r.observations} submitted Raw QA observation${
                    r.observations === 1 ? "" : "s"
                  } in ${periodLabel(period)}`;
            const trainerTitle = r.evaluations === 0
              ? period.kind === "all"
                ? "No completed calibration"
                : `No calibration in ${periodLabel(period)}`
              : period.kind === "all"
                ? `${r.evaluations} evaluation${r.evaluations === 1 ? "" : "s"}`
                : `Mean of ${r.evaluations} calibrated evaluation${
                    r.evaluations === 1 ? "" : "s"
                  } in ${periodLabel(period)}`;
            const gapTitle = gap === null
              ? "Needs both a Raw QA observation and a calibration"
              : "Trainer minus Raw QA, in percentage points. Positive means the Trainer scored higher than Raw QA.";
            const prevText = formatPercent(t.previous);
            const currText = formatPercent(t.current);
            const trendTitle = t.direction === "none"
              ? "No submitted calibrated evaluation under the active rubric yet"
              : t.direction === "baseline"
                ? "First calibrated evaluation under the active rubric. There is no earlier score to compare it against, so no direction is claimed."
                : `Current minus previous calibrated score: ${
                    t.delta !== null && t.delta > 0 ? "+" : ""
                  }${t.delta} pts`;

            const name = (
              <>
                {r.name}
                {r.is_inactive && (
                  <span className="text-[11.5px] text-ink-45 ml-2 font-normal">
                    {r.status}
                  </span>
                )}
                {r.evaluations === 0 && rawScore === null && (
                  <span
                    className="text-[11.5px] text-ink-45 ml-2 font-normal"
                    title="On the representative roster, but neither observed nor evaluated yet"
                  >
                    Not yet assessed
                  </span>
                )}
              </>
            );

            return (
              <li key={r.id}>
                <button
                  onClick={() => onOpen(r.id)}
                  className="w-full text-left px-5 py-3.5 hover:bg-ground-2 transition-colors"
                >
                  {/* Wide: one row, columns aligned with the captions above. */}
                  <span className="hidden sm:flex items-center gap-4">
                    <Avatar name={r.name} />
                    <span className="flex-1 min-w-0 text-[14.5px] font-medium text-ink truncate">
                      {name}
                    </span>
                    <span
                      className="font-mono text-[14px] tabular-nums w-[4.5rem] text-right"
                      title={rawTitle}
                    >
                      {rawText}
                    </span>
                    <span
                      className="font-mono text-[14px] tabular-nums w-[4.5rem] text-right"
                      title={trainerTitle}
                    >
                      {trainerText}
                    </span>
                    <span
                      className="font-mono text-[13px] tabular-nums w-[5rem] text-right whitespace-nowrap text-ink-70"
                      title={gapTitle}
                    >
                      {formatGap(gap)}
                    </span>
                    <span className="w-px self-stretch bg-rule-soft mx-1" aria-hidden="true" />
                    <span
                      className="font-mono text-[14px] tabular-nums w-[4.5rem] text-right text-ink-70"
                      title="Previous calibrated score"
                    >
                      {prevText}
                    </span>
                    <span
                      className="font-mono text-[14px] tabular-nums w-[4.5rem] text-right"
                      title="Current calibrated score"
                    >
                      {currText}
                    </span>
                    <span className="w-[7rem]">
                      <TrendTag trend={t.direction} title={trendTitle} />
                    </span>
                  </span>

                  {/* Narrow: the row stacks rather than dropping a figure. The
                      name gets its own line — never truncated — and all four
                      figures follow in a two-column block, each one labelled. */}
                  <span className="sm:hidden block">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={r.name} />
                      <span className="text-[14.5px] font-medium text-ink">{name}</span>
                    </span>
                    <span className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-ink-45">
                      <span title={rawTitle}>
                        Raw QA{" "}
                        <span className="font-mono text-[13px] tabular-nums text-ink">
                          {rawText}
                        </span>
                      </span>
                      <span title={trainerTitle}>
                        Trainer{" "}
                        <span className="font-mono text-[13px] tabular-nums text-ink">
                          {trainerText}
                        </span>
                      </span>
                      <span title={gapTitle}>
                        Gap{" "}
                        <span className="font-mono text-[13px] tabular-nums text-ink-70 whitespace-nowrap">
                          {formatGap(gap)}
                        </span>
                      </span>
                      <span title="Previous calibrated score">
                        Previous{" "}
                        <span className="font-mono text-[13px] tabular-nums text-ink-70">
                          {prevText}
                        </span>
                      </span>
                      <span title="Current calibrated score">
                        Current{" "}
                        <span className="font-mono text-[13px] tabular-nums text-ink">
                          {currText}
                        </span>
                      </span>
                      <span className="col-span-2">
                        Trend <TrendTag trend={t.direction} title={trendTitle} />
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      )}

      {/* Stated, never implied by an absence. A short table because nobody was
          assessed and a short table because a read failed look identical, and
          only one of them is an answer. */}
      {period.kind !== "all" && (visible.length === 0 || quiet > 0) && (
        <p className="text-[12.5px] text-ink-45 mt-2">
          {visible.length === 0
            ? `No representatives had assessments in ${periodLabel(period)}.`
            : `${quiet} representative${quiet === 1 ? "" : "s"} had no assessments in ${periodLabel(
                period,
              )}.`}
        </p>
      )}
    </section>
  );
}
