import { useCallback, useEffect, useMemo, useState } from "react";
import { listRepository, statsFrom, type RepositoryRow } from "@/lib/repository";
import { formatDate, formatDuration } from "@/lib/format";

interface Props {
  onOpenRecord: (callId: string) => void;
  onBack: () => void;
}

type SortKey = "recent" | "score_low" | "score_high" | "rep";

/**
 * The Quality Repository.
 *
 * The workspace is named for the container, not its contents: teaching moments,
 * case studies and knowledge articles will live here alongside evaluations. The
 * artifact itself keeps the name analysts already use.
 *
 * Every completed evaluation has a permanent home here. Sorted newest-first by
 * default, but the more useful default in practice is score_low — the calls
 * worth revisiting are the ones that went badly, not the ones that went well.
 */
export function QualityRepository({ onOpenRecord, onBack }: Props): JSX.Element {
  const [rows, setRows] = useState<RepositoryRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [filter, setFilter] = useState<"all" | "unpublished" | "escalations" | "revised">("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRows(await listRepository());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => statsFrom(rows ?? []), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = (rows ?? []).filter((r) => {
      if (filter === "unpublished" && r.published_at !== null) return false;
      if (filter === "escalations" && !r.is_high_risk) return false;
      if (filter === "revised" && r.superseded_count === 0) return false;
      if (!q) return true;
      return (
        r.call_title.toLowerCase().includes(q) ||
        (r.agent_name ?? "").toLowerCase().includes(q) ||
        (r.reviewer_name ?? "").toLowerCase().includes(q) ||
        (r.trainer_name ?? "").toLowerCase().includes(q) ||
        r.summary_note.toLowerCase().includes(q)
      );
    });

    list = [...list].sort((a, b) => {
      switch (sort) {
        case "score_low":
          return (a.overall_score ?? 999) - (b.overall_score ?? 999);
        case "score_high":
          return (b.overall_score ?? -1) - (a.overall_score ?? -1);
        case "rep":
          return (a.agent_name ?? "").localeCompare(b.agent_name ?? "");
        default:
          return (b.submitted_at ?? "").localeCompare(a.submitted_at ?? "");
      }
    });
    return list;
  }, [rows, query, sort, filter]);

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <header className="pt-8 pb-5 border-b border-rule">
        <button
          onClick={onBack}
          className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
        >
          &larr; All calls
        </button>
        <h1 className="font-display text-3xl mt-3">Quality repository</h1>
        <p className="text-ink-70 text-[14px] mt-1 max-w-2xl">
          Completed evaluations, permanently. This is the system of record
          &mdash; anywhere else they appear is a copy.
        </p>
      </header>

      {rows !== null && rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 border-b border-rule">
          <Figure value={String(stats.completed)} caption="completed" />
          <Figure
            value={stats.averageScore === null ? "—" : `${stats.averageScore}%`}
            caption="average score"
          />
          <Figure value={String(stats.moments)} caption="teaching moments" />
          <Figure value={String(stats.evidence)} caption="quotes captured" />
          <Figure value={String(stats.pendingPublication)} caption="unpublished" />
        </div>
      )}

      {error && <p className="mt-5 text-[13px] text-[#AC3A2A]">{error}</p>}

      <div className="mt-6 flex gap-3 flex-wrap items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by call, rep, reviewer or summary"
          className="flex-1 min-w-[240px] border border-rule rounded px-3.5 py-2.5 bg-white text-[15px]
                     focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="border border-rule rounded px-3 py-2.5 bg-white text-[13px]"
        >
          <option value="recent">Most recent</option>
          <option value="score_low">Lowest score first</option>
          <option value="score_high">Highest score first</option>
          <option value="rep">By representative</option>
        </select>
      </div>

      <div className="flex gap-1.5 flex-wrap mt-3">
        {(
          [
            ["all", "All"],
            ["unpublished", "Not published"],
            ["escalations", "Escalations"],
            ["revised", "Revised"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`border rounded-full px-3 py-1 text-[12.5px] ${
              filter === key ? "bg-ink text-ground border-ink" : "border-rule hover:bg-ground-2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {rows === null ? (
          <p className="text-ink-45 text-sm">Loading&hellip;</p>
        ) : rows.length === 0 ? (
          <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
            <h2 className="font-display text-2xl mb-2">Nothing completed yet</h2>
            <p className="text-ink-70 max-w-md mx-auto">
              Completed evaluations arrive here once a calibration is submitted.
              They stay permanently.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="text-ink-70 py-8 text-center">Nothing matches that.</p>
        ) : (
          <ul className="space-y-2.5">
            {visible.map((r) => (
              <li
                key={r.call_id}
                className="bg-card border border-rule-soft rounded px-4 py-3.5 flex justify-between items-start gap-4 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <button
                      onClick={() => onOpenRecord(r.call_id)}
                      className="font-display text-lg hover:underline underline-offset-2 text-left"
                    >
                      {r.call_title}
                    </button>
                    {r.is_high_risk && (
                      <span className="text-[11px] border border-[#AC3A2A] text-[#AC3A2A] rounded-full px-2 py-0.5">
                        Escalation
                      </span>
                    )}
                    {r.reward_tier === "premium" && (
                      <span className="text-[11px] border border-[#1F7A4D] text-[#1F7A4D] rounded-full px-2 py-0.5">
                        Premium
                      </span>
                    )}
                    {r.reward_tier === "kudos" && (
                      <span className="text-[11px] border border-[#1F7A4D] text-[#1F7A4D] rounded-full px-2 py-0.5">
                        Kudos
                      </span>
                    )}
                    {r.under_revision && (
                      <span className="text-[11px] border border-[#96690A] text-[#96690A] rounded-full px-2 py-0.5">
                        Being revised
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-ink-45 mt-0.5">
                    {r.agent_name || "Rep not set"} &middot; reviewed by{" "}
                    {r.reviewer_name ?? "—"} &middot; calibrated by {r.trainer_name ?? "—"}
                    {r.submitted_at && ` · ${formatDate(r.submitted_at)}`}
                    {r.rubric_version && ` · rubric v${r.rubric_version}`}
                  </p>
                  <p className="font-mono text-[11px] text-ink-45 mt-1">
                    {r.evidence_count} quote{r.evidence_count === 1 ? "" : "s"} ·{" "}
                    {r.moment_count} moment{r.moment_count === 1 ? "" : "s"}
                    {r.calibration_changes > 0 && ` · ${r.calibration_changes} changed at calibration`}
                    {r.superseded_count > 0 && ` · v${r.superseded_count + 1}`}
                    {r.duration_ms ? ` · ${formatDuration(r.duration_ms)}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <span className="font-display text-2xl block leading-none">
                      {r.overall_score === null ? "—" : `${r.overall_score}%`}
                    </span>
                    <span className="text-[11px] text-ink-45">
                      {r.published_at ? "published" : "not published"}
                    </span>
                  </div>
                  <button
                    onClick={() => onOpenRecord(r.call_id)}
                    className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium hover:opacity-85"
                  >
                    Open evaluation
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Figure({ value, caption }: { value: string; caption: string }): JSX.Element {
  return (
    <div className="py-4 pr-5 border-r border-rule-soft last:border-r-0">
      <span className="font-display text-2xl block leading-none mb-1.5">{value}</span>
      <span className="text-[11.5px] text-ink-45">{caption}</span>
    </div>
  );
}
