import { useEffect, useState } from "react";
import {
  listRepPerformance,
  repEvaluations,
  trendFrom,
  type RepPerformance,
} from "@/lib/performance";
import { listVersions } from "@/lib/rubricAdmin";

/**
 * The compact Dashboard summary.
 *
 * Deliberately small: the Dashboard answers "how are we doing", and this is
 * the one line of that answer about people. Anything more belongs behind
 * "View rep performance".
 */
export function RepPerformanceSummary({
  onOpen,
}: {
  onOpen: (repId?: string) => void;
}): JSX.Element | null {
  const [rows, setRows] = useState<RepPerformance[] | null>(null);
  const [trends, setTrends] = useState<Record<string, "up" | "down" | "flat" | "unknown">>({});
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
      const all = await listRepPerformance(active.id);
      setRows(all);

      // Trend needs the individual evaluations, so only the few shown here.
      const top = all.slice(0, 5);
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

  return (
    <section className="mt-8">
      <div className="flex justify-between items-baseline gap-4 mb-2.5">
        <h2 className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
          Rep performance
          {versionLabel && <span className="ml-2">rubric v{versionLabel}</span>}
        </h2>
        <button
          onClick={() => onOpen()}
          className="text-[12px] text-ink-45 underline underline-offset-2 hover:text-ink"
        >
          View rep performance
        </button>
      </div>

      <ul className="bg-card border border-rule-soft rounded divide-y divide-rule-soft">
        {rows.slice(0, 5).map((r) => {
          const trend = trends[r.representative_id];
          return (
            <li key={r.representative_id}>
              <button
                onClick={() => onOpen(r.representative_id)}
                className="w-full text-left px-4 py-2.5 hover:bg-ground flex items-center gap-4"
              >
                <span className="flex-1 min-w-0 text-[14px] truncate">
                  {r.representative_name}
                  {r.is_inactive && (
                    <span className="text-[11px] text-ink-45 ml-2">{r.status}</span>
                  )}
                </span>
                <span className="font-mono text-[14px] w-14 text-right">
                  {r.score === null ? "—" : `${r.score}%`}
                </span>
                <span className="text-[12px] text-ink-45 w-24 text-right">
                  {r.evaluations} evaluation{r.evaluations === 1 ? "" : "s"}
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
                  {trend === "up" ? "↑" : trend === "down" ? "↓" : trend === "flat" ? "→" : "·"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {rows.length > 5 && (
        <p className="text-[12px] text-ink-45 mt-1.5">
          {rows.length - 5} more representative{rows.length - 5 === 1 ? "" : "s"}.
        </p>
      )}
    </section>
  );
}
