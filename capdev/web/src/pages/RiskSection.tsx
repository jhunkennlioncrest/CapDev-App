import { useCallback, useEffect, useState } from "react";
import {
  RISK_CATEGORIES,
  riskRegister,
  riskSummary,
  setRiskStatus,
  type RiskRecord,
  type RiskStatus,
  type RiskSummary,
} from "@/lib/risk";
import type { Session } from "@/lib/types";

const CATEGORY_LABEL = Object.fromEntries(
  RISK_CATEGORIES.map((c) => [c.value, c.label]),
) as Record<string, string>;

/**
 * Risk & escalations.
 *
 * Its own section, never folded into representative performance. A risk is a
 * question about what needs attention; a score is a question about how someone
 * performed. Combining them would answer neither.
 */
export function RiskSection({
  session,
  onOpenCall,
}: {
  session: Session;
  onOpenCall?: (callId: string) => void;
}): JSX.Element | null {
  const [summary, setSummary] = useState<RiskSummary | null>(null);
  const [rows, setRows] = useState<RiskRecord[] | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<RiskStatus | "all">("open");
  const [error, setError] = useState<string | null>(null);

  const canManage = session.permissions.includes("calibration.perform");

  const load = useCallback(async (): Promise<void> => {
    try {
      const [s, r] = await Promise.all([
        riskSummary(),
        riskRegister(filter === "all" ? undefined : filter),
      ]);
      setSummary(s);
      setRows(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Nothing raised at all: no section rather than an empty one taking up room.
  if (summary === null || summary.total === 0) return null;

  return (
    <section className="mt-8">
      <div className="flex justify-between items-baseline gap-4 flex-wrap mb-1">
        <h2 className="font-display text-2xl">Risk &amp; escalations</h2>
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-[12.5px] text-ink-45 underline underline-offset-2 hover:text-ink"
        >
          {open ? "Hide" : "Inspect"}
        </button>
      </div>
      <p className="text-[13px] text-ink-70 mb-3 max-w-2xl">
        Things needing attention beyond the score. A risk never changes a
        representative&rsquo;s performance figure.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 border-y border-rule">
        <Figure value={summary.open} caption="open" />
        <Figure value={summary.total} caption="total" />
        {summary.open_escalations > 0 && (
          <Figure value={summary.open_escalations} caption="need escalation" alert />
        )}
        {summary.awaiting_determination > 0 && canManage && (
          <Figure value={summary.awaiting_determination} caption="awaiting review" alert />
        )}
      </div>

      {error && <p className="text-[12.5px] text-[#AC3A2A] mt-2">{error}</p>}

      {open && (
        <div className="mt-3">
          <div className="flex gap-3 mb-2 text-[12px]">
            {(["open", "resolved", "closed", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  filter === f
                    ? "font-semibold underline underline-offset-2"
                    : "text-ink-45 hover:text-ink"
                }
              >
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {rows === null ? (
            <p className="text-[12.5px] text-ink-45">Loading&hellip;</p>
          ) : rows.length === 0 ? (
            <p className="text-[12.5px] text-ink-45 border border-dashed border-rule rounded px-4 py-4">
              Nothing {filter === "all" ? "recorded" : filter}.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="bg-card border border-rule-soft rounded px-3.5 py-2.5"
                >
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <span className="text-[13.5px] font-semibold">
                      {r.representative_name ?? "Unassigned"}
                    </span>
                    <span className="text-[12px] border border-rule rounded-full px-2 py-0.5">
                      {CATEGORY_LABEL[r.category] ?? r.category}
                    </span>
                    {r.requires_escalation && r.status === "open" && (
                      <span className="text-[11px] text-[#AC3A2A] border border-[#AC3A2A] rounded-full px-2 py-0.5">
                        Escalate
                      </span>
                    )}
                    <span className="text-[12px] text-ink-45 flex-1 min-w-0">
                      {r.identified_by_role} &middot;{" "}
                      {new Date(r.identified_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <StatusPill status={r.status} />
                  </div>

                  <p className="text-[12.5px] text-ink-70 mt-1">{r.note}</p>

                  {/* Both positions, the way a scoring disagreement is kept. */}
                  {r.determination && (
                    <p className="text-[12.5px] mt-1">
                      <span className="text-ink-45">
                        Trainer:{" "}
                        {r.determination === "valid" ? "confirmed" : "not a risk"}
                      </span>
                      {r.determination_note && ` — ${r.determination_note}`}
                    </p>
                  )}
                  {!r.determination && canManage && (
                    <p className="text-[12px] text-[#96690A] mt-1">
                      Awaiting a trainer&rsquo;s determination.
                    </p>
                  )}

                  <div className="flex gap-3 items-center mt-1.5 flex-wrap">
                    {r.evidence_count > 0 && (
                      <span className="text-[11.5px] text-ink-45">
                        {r.evidence_count} cited passage
                        {r.evidence_count === 1 ? "" : "s"}
                      </span>
                    )}
                    {onOpenCall && (
                      <button
                        onClick={() => onOpenCall(r.call_id)}
                        title={r.call_title}
                        className="text-[12px] text-accent underline underline-offset-2"
                      >
                        open call
                      </button>
                    )}
                    {canManage && r.status !== "closed" && (
                      <div className="flex gap-2 ml-auto">
                        {r.status === "open" && (
                          <button
                            onClick={() =>
                              void setRiskStatus(r.id, "resolved").then(load)
                            }
                            className="border border-rule rounded px-2.5 py-1 text-[12px] hover:bg-ground-2"
                          >
                            Mark resolved
                          </button>
                        )}
                        <button
                          onClick={() => void setRiskStatus(r.id, "closed").then(load)}
                          className="text-[12px] text-ink-45 underline underline-offset-2 hover:text-ink"
                        >
                          Close
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Figure({
  value,
  caption,
  alert,
}: {
  value: number;
  caption: string;
  alert?: boolean;
}): JSX.Element {
  return (
    <div className="px-1 py-3.5 text-center border-r border-rule last:border-r-0">
      <span
        className="font-display text-3xl block leading-none mb-1.5"
        style={alert ? { color: "#AC3A2A" } : undefined}
      >
        {value}
      </span>
      <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-45">
        {caption}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: RiskStatus }): JSX.Element {
  const colour =
    status === "open" ? "#96690A" : status === "resolved" ? "#1F7A4D" : undefined;
  return (
    <span
      className="text-[11px] border rounded-full px-2 py-0.5 shrink-0"
      style={colour ? { color: colour, borderColor: colour } : undefined}
    >
      {status}
    </span>
  );
}
