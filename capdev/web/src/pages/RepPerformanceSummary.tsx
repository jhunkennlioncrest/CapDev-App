import { useEffect, useState } from "react";
import {
  listRepPerformance,
  listRepRawObservationPerformance,
  calibratedTrends,
  type RepTrend,
  formatGap,
  scoreGap,
  type RepPerformance,
} from "@/lib/performance";
import { listVersions } from "@/lib/rubricAdmin";
import { SectionHeading, TrendTag, Avatar, Toggle } from "@/components/dash";

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
}: {
  onOpen: (repId?: string) => void;
}): JSX.Element | null {
  const [rows, setRows] = useState<RepPerformance[] | null>(null);
  /** Raw QA score by representative id. Absent means never observed. */
  const [rawScores, setRawScores] = useState<Record<string, number | null>>({});
  const [trends, setTrends] = useState<Record<string, RepTrend>>({});
  const [showInactive, setShowInactive] = useState(false);
  const [versionLabel, setVersionLabel] = useState<string>("");

  useEffect(() => {
    void (async () => {
      const versions = await listVersions();
      const active = versions.find((v) => v.status === "active");
      if (!active) {
        setRows([]);
        return;
      }
      setVersionLabel(active.version_label);
      const [all, raw] = await Promise.all([
        listRepPerformance(active.id),
        listRepRawObservationPerformance(active.id),
      ]);
      setRows(all);
      setRawScores(
        Object.fromEntries(
          raw
            .filter((r) => r.observations > 0)
            .map((r) => [r.representative_id, r.score]),
        ),
      );

      // Calibrated history for the whole roster, newest-first and stopping as
      // soon as everyone has the two evaluations the trend needs. Only those
      // with calibrations are asked about; anyone the read does not answer for
      // falls to "No trend yet" below.
      const scored = all.filter((r) => r.evaluations > 0);
      setTrends(
        await calibratedTrends(scored.map((r) => r.representative_id), active.id),
      );
    })();
  }, []);

  if (rows === null || rows.length === 0) return null;

  // Inactive representatives stay in the data — the detail view and their
  // history remain reachable — but a former employee is not a current concern,
  // so they are out of the default list.
  const visible = showInactive ? rows : rows.filter((r) => !r.is_inactive);
  const hiddenCount = rows.length - rows.filter((r) => !r.is_inactive).length;

  return (
    <section className="mt-8">
      <SectionHeading
        title="Representative performance"
        meta={versionLabel ? `Rubric v${versionLabel}` : undefined}
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
          <span className="w-[7rem]">Trend</span>
        </div>

        <ul className="divide-y divide-rule-soft">
          {visible.map((r) => {
            const t: RepTrend = trends[r.representative_id] ??
              { previous: null, current: null, delta: null, direction: "none", baseline: false };
            const rawScore = r.representative_id in rawScores
              ? rawScores[r.representative_id] ?? null
              : null;
            const gap = scoreGap(rawScore, r.score);

            const rawText = rawScore === null ? "—" : `${rawScore}%`;
            const trainerText = r.score === null ? "—" : `${r.score}%`;
            const rawTitle = rawScore === null
              ? "No submitted Raw QA observation"
              : "Raw QA: criteria met ÷ criteria assessed";
            const trainerTitle = r.evaluations === 0
              ? "No completed calibration"
              : `${r.evaluations} evaluation${r.evaluations === 1 ? "" : "s"}`;
            const gapTitle = gap === null
              ? "Needs both a Raw QA observation and a calibration"
              : "Raw QA minus Trainer, in percentage points";
            const prevText = t.previous === null ? "—" : `${t.previous}%`;
            const currText = t.current === null ? "—" : `${t.current}%`;
            const trendTitle = t.direction === "none"
              ? "No submitted calibrated evaluation under the active rubric yet"
              : t.baseline
                ? "Only one calibrated evaluation available; Stable is the neutral baseline."
                : `Current minus previous calibrated score: ${
                    t.delta !== null && t.delta > 0 ? "+" : ""
                  }${t.delta} pts`;

            const name = (
              <>
                {r.representative_name}
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
              <li key={r.representative_id}>
                <button
                  onClick={() => onOpen(r.representative_id)}
                  className="w-full text-left px-5 py-3.5 hover:bg-ground-2 transition-colors"
                >
                  {/* Wide: one row, columns aligned with the captions above. */}
                  <span className="hidden sm:flex items-center gap-4">
                    <Avatar name={r.representative_name} />
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
                      <Avatar name={r.representative_name} />
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
    </section>
  );
}
