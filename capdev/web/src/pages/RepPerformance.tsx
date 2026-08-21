import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listRepPerformance,
  repCriteria,
  repEvaluations,
  repVariance,
  trendFrom,
  type CriterionPerformance,
  type RepEvaluation,
  type RepPerformance as RepRow,
  type VarianceRow,
} from "@/lib/performance";
import { listVersions, type RubricVersionRow } from "@/lib/rubricAdmin";
import { formatDate } from "@/lib/format";

/**
 * How one representative is doing.
 *
 * Everything here comes from completed calibrated evaluations and can be
 * traced back to them. A score nobody can open is a rumour.
 */
export function RepPerformance({
  onBack,
  onOpenRecord,
  initialRepId,
}: {
  onBack: () => void;
  onOpenRecord: (callId: string) => void;
  initialRepId?: string | null;
}): JSX.Element {
  const [versions, setVersions] = useState<RubricVersionRow[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [rows, setRows] = useState<RepRow[]>([]);
  const [repId, setRepId] = useState<string | null>(initialRepId ?? null);
  const [evaluations, setEvaluations] = useState<RepEvaluation[]>([]);
  const [criteria, setCriteria] = useState<CriterionPerformance[]>([]);
  const [variance, setVariance] = useState<VarianceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const v = await listVersions();
      setVersions(v);
      setVersionId((current) => current ?? v.find((x) => x.status === "active")?.id ?? null);
    })();
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (!versionId) return;
    setLoading(true);
    const all = await listRepPerformance(versionId);
    setRows(all);
    const chosen = repId ?? all[0]?.representative_id ?? null;
    setRepId(chosen);
    if (chosen) {
      const [ev, cr, va] = await Promise.all([
        repEvaluations(chosen, versionId),
        repCriteria(chosen, versionId),
        repVariance(chosen, versionId),
      ]);
      setEvaluations(ev);
      setCriteria(cr);
      setVariance(va);
    }
    setLoading(false);
  }, [versionId, repId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rep = rows.find((r) => r.representative_id === repId) ?? null;
  const trend = useMemo(() => trendFrom(evaluations), [evaluations]);
  const version = versions.find((v) => v.id === versionId);

  return (
    <div className="max-w-5xl mx-auto px-6 pb-20">
      <button
        onClick={onBack}
        className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
      >
        &larr; Dashboard
      </button>

      <h1 className="font-display text-3xl mt-3 mb-1">Rep performance</h1>
      <p className="text-[13px] text-ink-70 mb-5 max-w-xl">
        From completed calibrations only. What a reviewer observed is not what
        the organisation decided.
      </p>

      <div className="flex gap-3 flex-wrap mb-6">
        <label className="block">
          <span className="block text-[12px] font-semibold mb-1.5">Representative</span>
          <select
            value={repId ?? ""}
            onChange={(e) => setRepId(e.target.value)}
            className="border border-rule rounded px-2.5 py-2 bg-white text-sm min-w-56"
          >
            {rows.map((r) => (
              <option key={r.representative_id} value={r.representative_id}>
                {r.representative_name}
                {r.is_inactive ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[12px] font-semibold mb-1.5">
            Rubric version
            <span className="font-normal text-ink-45"> — scores are not comparable across versions</span>
          </span>
          <select
            value={versionId ?? ""}
            onChange={(e) => {
              setVersionId(e.target.value);
            }}
            className="border border-rule rounded px-2.5 py-2 bg-white text-sm"
          >
            {versions
              .filter((v) => v.status === "active" || v.status === "archived")
              .map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_label}
                  {v.status === "active" ? " — current" : ""}
                </option>
              ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : !rep ? (
        <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
          <h2 className="font-display text-2xl mb-2">Nothing to show yet</h2>
          <p className="text-ink-70 max-w-md mx-auto">
            No completed evaluations under v{version?.version_label} for any
            representative. Finish a calibration first.
          </p>
        </div>
      ) : (
        <>
          <div className="flex justify-between items-baseline gap-4 flex-wrap mb-1">
            <h2 className="font-display text-2xl">
              {rep.representative_name}
              {rep.is_inactive && (
                <span className="text-[12px] border border-rule text-ink-45 rounded-full px-2 py-0.5 ml-2.5 align-middle">
                  {rep.status}
                </span>
              )}
            </h2>
            <span className="text-[12px] text-ink-45">
              {rep.department || "no department"}
              {rep.employee_ref && ` · ${rep.employee_ref}`}
            </span>
          </div>

          <div className="grid sm:grid-cols-4 border-y border-rule my-4">
            <Figure
              value={rep.score === null ? "—" : `${rep.score}%`}
              caption="QA score"
              large
            />
            <Figure value={String(rep.evaluations)} caption="completed evaluations" />
            <Figure
              value={`${rep.non_negotiables_clean}/${rep.evaluations}`}
              caption="clean on non-negotiables"
              warn={rep.non_negotiables_clean < rep.evaluations}
            />
            <Figure
              value={
                trend.direction === "unknown"
                  ? "—"
                  : `${trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "→"} ${
                      trend.delta === null ? "" : `${Math.abs(trend.delta)}%`
                    }`
              }
              caption="trend"
            />
          </div>

          {/* The number has to be openable, or it is just an assertion. */}
          <p className="text-[12.5px] text-ink-70 mb-6">
            {rep.criteria_met} of {rep.criteria_assessed} criteria met across{" "}
            {rep.evaluations} completed evaluation
            {rep.evaluations === 1 ? "" : "s"} under v{rep.version_label}.
            {rep.mean_of_evaluations !== null &&
              rep.score !== null &&
              Math.abs(rep.mean_of_evaluations - rep.score) >= 0.5 && (
                <>
                  {" "}
                  Averaging the evaluations individually gives{" "}
                  {rep.mean_of_evaluations}% — the figure above pools every
                  criterion instead, so a call with few applicable criteria does
                  not weigh as much as a full one.
                </>
              )}
            {trend.direction === "unknown" && ` Trend needs six evaluations — ${trend.basis}.`}
          </p>

          {criteria.length > 0 && (
            <section className="mb-7">
              <SectionHead title="Where the score comes from" />
              <ul className="space-y-1.5">
                {criteria
                  .filter((c) => c.times_applicable > 0)
                  .map((c) => (
                    <li key={c.criterion_id} className="flex items-center gap-3">
                      <span className="font-mono text-[11px] text-ink-45 w-14 shrink-0">
                        {c.code}
                      </span>
                      <span className="text-[13.5px] flex-1 min-w-0 truncate">
                        {c.label || c.statement}
                        {c.section_kind === "non_negotiable" && (
                          <span className="text-[10.5px] text-ink-45 ml-1.5">
                            non-negotiable
                          </span>
                        )}
                      </span>
                      <span className="w-28 shrink-0 h-1.5 bg-ground-2 rounded-full overflow-hidden">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${c.met_rate ?? 0}%`,
                            background:
                              (c.met_rate ?? 0) >= 90
                                ? "#1F7A4D"
                                : (c.met_rate ?? 0) >= 70
                                  ? "#96690A"
                                  : "#AC3A2A",
                          }}
                        />
                      </span>
                      <span className="font-mono text-[12px] w-20 text-right shrink-0">
                        {c.met_rate}% <span className="text-ink-45">{c.times_met}/{c.times_applicable}</span>
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          {variance.length > 0 && (
            <section className="mb-7">
              <SectionHead title="Where reviewer and trainer disagreed" />
              <p className="text-[12.5px] text-ink-70 mb-2">
                About the calibration process, not about{" "}
                {rep.representative_name.split(" ")[0]}. Frequent disagreement
                usually means the criterion is ambiguous or a reviewer needs
                coaching.
              </p>
              <ul className="space-y-1">
                {variance.map((v) => (
                  <li key={v.code} className="flex items-baseline gap-3 text-[13.5px]">
                    <span className="font-mono text-[11px] text-ink-45 w-14 shrink-0">
                      {v.code}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{v.label || v.section_title}</span>
                    <span className="text-[12px] text-ink-45">
                      {v.variances} of {v.compared}
                      {v.missed_failures > 0 && ` · ${v.missed_failures} missed`}
                      {v.false_failures > 0 && ` · ${v.false_failures} false`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <SectionHead title="The evaluations behind this" />
            <ul className="space-y-2">
              {evaluations.map((e) => (
                <li
                  key={e.evaluation_id}
                  className="bg-card border border-rule-soft rounded px-4 py-3 flex justify-between items-start gap-4 flex-wrap"
                >
                  <div className="min-w-0">
                    <button
                      onClick={() => onOpenRecord(e.call_id)}
                      className="text-[14px] text-left hover:underline underline-offset-2"
                    >
                      {e.call_title}
                    </button>
                    <p className="text-[12px] text-ink-45 mt-0.5">
                      {formatDate(e.submitted_at)} · v{e.version_label}
                      {e.calibrated_by && ` · calibrated by ${e.calibrated_by}`}
                      {e.non_negotiables_all_pass === false && (
                        <span className="text-[#AC3A2A]"> · non-negotiable failed</span>
                      )}
                    </p>
                    {e.reviewer_score !== null && e.changed_criteria > 0 && (
                      <p className="text-[11.5px] text-ink-45 mt-0.5">
                        reviewer observed {e.reviewer_score}% · {e.changed_criteria} changed at
                        calibration
                      </p>
                    )}
                  </div>
                  <span className="font-mono text-[15px] shrink-0">
                    {e.overall_score === null ? "—" : `${e.overall_score}%`}
                    <span className="text-[11px] text-ink-45 ml-1.5">
                      {e.yes_count}/{e.applicable_count}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function SectionHead({ title }: { title: string }): JSX.Element {
  return (
    <h3 className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 border-b border-rule pb-1.5 mb-3">
      {title}
    </h3>
  );
}

function Figure({
  value,
  caption,
  large = false,
  warn = false,
}: {
  value: string;
  caption: string;
  large?: boolean;
  warn?: boolean;
}): JSX.Element {
  return (
    <div className="py-3.5 pr-5 border-r border-rule-soft last:border-r-0">
      <span
        className={`font-display block leading-none mb-1 ${large ? "text-3xl" : "text-2xl"}`}
        style={warn ? { color: "#96690A" } : undefined}
      >
        {value}
      </span>
      <span className="text-[11.5px] text-ink-45">{caption}</span>
    </div>
  );
}
