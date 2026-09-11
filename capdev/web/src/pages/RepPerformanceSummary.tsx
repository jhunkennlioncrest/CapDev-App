import { useEffect, useState } from "react";
import {
  listRepPerformance,
  listRepRawObservationPerformance,
  repEvaluations,
  trendFrom,
  formatGap,
  scoreGap,
  type RepPerformance,
} from "@/lib/performance";
import { listVersions } from "@/lib/rubricAdmin";

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
  const [trends, setTrends] = useState<Record<string, "up" | "down" | "flat" | "unknown">>({});
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

      // Trend needs the individual evaluations, so only the few shown here —
      // and only those with evaluations to read a trend from.
      const top = all.filter((r) => r.evaluations > 0).slice(0, 5);
      const results = await Promise.all(
        top.map(async (r) => [
          r.representative_id,
          trendFrom(await repEvaluations(r.representative_id, active.id)).direction,
        ] as const),
      );
      setTrends(Object.fromEntries(results));
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
      <div className="flex justify-between items-baseline gap-4 mb-2.5">
        <h2 className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
          Rep performance
          {versionLabel && <span className="ml-2">rubric v{versionLabel}</span>}
        </h2>
        <span className="flex items-baseline gap-3">
          {/* Only offered when something is actually hidden, so the control
              does not imply there are former representatives when there are
              none. */}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowInactive((v) => !v)}
              className="text-[12px] text-ink-45 underline underline-offset-2 hover:text-ink"
            >
              {showInactive
                ? "Hide inactive"
                : `Show inactive (${hiddenCount})`}
            </button>
          )}
        </span>
      </div>

      {/* Three numeric columns need naming: "88% 82% +6 pts" is unreadable
          without them, and guessing which is which is exactly the confusion
          that blending the two scores would cause. */}
      <div className="flex items-baseline gap-2 sm:gap-4 px-4 pb-1.5 text-[10.5px] text-ink-45">
        <span className="flex-1 min-w-0" />
        <span className="w-14 sm:w-16 text-right">Raw QA</span>
        <span className="w-14 sm:w-16 text-right">Trainer</span>
        {/* Below sm the Gap steps aside rather than squeezing the name down to
            "Mo...". Both of its operands are on the same row, so nothing is
            lost that the reader cannot see; a representative nobody can
            identify is the worse failure. */}
        <span className="hidden sm:block w-20 text-right">Gap</span>
        <span className="w-5" />
      </div>

      <ul className="bg-card border border-rule-soft rounded divide-y divide-rule-soft">
        {visible.slice(0, 5).map((r) => {
          const trend = trends[r.representative_id];
          const rawScore = r.representative_id in rawScores
            ? rawScores[r.representative_id] ?? null
            : null;
          const gap = scoreGap(rawScore, r.score);
          return (
            <li key={r.representative_id}>
              <button
                onClick={() => onOpen(r.representative_id)}
                className="w-full text-left px-4 py-2.5 hover:bg-ground flex items-center gap-2 sm:gap-4"
              >
                <span className="flex-1 min-w-0 text-[14px] truncate">
                  {r.representative_name}
                  {r.is_inactive && (
                    <span className="text-[11px] text-ink-45 ml-2">{r.status}</span>
                  )}
                  {r.evaluations === 0 && rawScore === null && (
                    <span
                      className="text-[11px] text-ink-45 ml-2"
                      title="On the representative roster, but neither observed nor evaluated yet"
                    >
                      &#9675; not yet assessed
                    </span>
                  )}
                </span>
                {/* Counts move to the tooltip: three numeric columns already
                    earn their width, and the sample size matters most when
                    someone is comparing the two figures. */}
                <span
                  className="font-mono text-[14px] w-14 sm:w-16 text-right"
                  title={
                    rawScore === null
                      ? "No submitted Raw QA observation"
                      : "Raw QA: criteria met ÷ criteria assessed"
                  }
                >
                  {rawScore === null ? "—" : `${rawScore}%`}
                </span>
                <span
                  className="font-mono text-[14px] w-14 sm:w-16 text-right"
                  title={
                    r.evaluations === 0
                      ? "No completed calibration"
                      : `${r.evaluations} evaluation${r.evaluations === 1 ? "" : "s"}`
                  }
                >
                  {r.score === null ? "—" : `${r.score}%`}
                </span>
                <span
                  className="hidden sm:block font-mono text-[13px] w-20 text-right
                             whitespace-nowrap text-ink-70"
                  title={
                    gap === null
                      ? "Needs both a Raw QA observation and a calibration"
                      : "Raw QA minus Trainer, in percentage points"
                  }
                >
                  {formatGap(gap)}
                </span>
                <span
                  className="w-5 text-center text-[13px]"
                  title={
                    trend === "unknown"
                      ? "Not enough evaluations to read a trend"
                      : undefined
                  }
                  style={{
                    color:
                      trend === "up" ? "#1F7A4D" : trend === "down" ? "#AC3A2A" : "#6B6F68",
                  }}
                >
                  {r.evaluations === 0
                    ? "·"
                    : trend === "up"
                      ? "↑"
                      : trend === "down"
                        ? "↓"
                        : trend === "flat"
                          ? "→"
                          : "·"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* The only route to the full roster. Passing no representative id opens
          the roster itself rather than a person — the previous generic link
          landed on whoever happened to sort first, which read as a selection
          nobody had made. */}
      <button
        onClick={() => onOpen()}
        className="text-[12px] text-ink-45 underline underline-offset-2
                   hover:text-ink mt-1.5"
      >
        View all {visible.length} representative{visible.length === 1 ? "" : "s"} &rarr;
      </button>
    </section>
  );
}
