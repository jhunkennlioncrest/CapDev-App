import { useCallback, useEffect, useState } from "react";
import { getQueue, startCalibration, type QueueItem } from "@/lib/evaluation";
import { formatDate, formatDuration } from "@/lib/format";

interface Props {
  onOpenCall: (id: string) => void;
  onBack: () => void;
}

/**
 * The calibration queue.
 *
 * Ordered oldest-first, deliberately. Two-stage workflows fail at the handoff:
 * raw submissions accumulate faster than they are calibrated, reviewers stop
 * seeing their work reach an outcome, and observation quality quietly decays.
 * The number that matters is the age of the oldest waiting item, so it is the
 * thing shown first and most prominently.
 */
export function CalibrationQueue({ onOpenCall, onBack }: Props): JSX.Element {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setItems(await getQueue());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function begin(item: QueueItem): Promise<void> {
    setStarting(item.assignment_id);
    setError(null);
    try {
      await startCalibration(item.raw_evaluation_id);
      onOpenCall(item.call_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(null);
    }
  }

  const waiting = (items ?? []).filter((i) => i.status === "waiting");
  const oldest = waiting.length > 0 ? waiting[0]?.days_waiting ?? 0 : 0;

  return (
    <div className="max-w-5xl mx-auto px-6 pb-20">
      <header className="pt-8 pb-5 border-b border-rule">
        <button
          onClick={onBack}
          className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
        >
          &larr; All calls
        </button>
        <h1 className="font-display text-3xl mt-3">Ready for calibration</h1>
        <p className="text-ink-70 text-[14px] mt-1 max-w-2xl">
          Raw observations waiting to be calibrated. Everything the reviewer
          captured carries forward &mdash; timestamps, notes and quotes are already
          there.
        </p>
      </header>

      {items !== null && items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 border-b border-rule">
          <Figure value={String(waiting.length)} caption="waiting" />
          <Figure
            value={String((items ?? []).filter((i) => i.status === "in_progress").length)}
            caption="in progress"
          />
          <Figure
            value={oldest < 1 ? "today" : `${Math.floor(oldest)}d`}
            caption="oldest waiting"
            warn={oldest >= 3}
          />
        </div>
      )}

      {error && <p className="mt-5 text-[13px] text-[#AC3A2A]">{error}</p>}

      <div className="mt-7">
        {items === null ? (
          <p className="text-ink-45 text-sm">Loading&hellip;</p>
        ) : items.length === 0 ? (
          <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
            <h2 className="font-display text-2xl mb-2">Queue is clear</h2>
            <p className="text-ink-70 max-w-md mx-auto">
              Nothing waiting. Raw observations appear here the moment a reviewer
              submits them.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li
                key={item.assignment_id}
                className="bg-card border border-rule-soft rounded px-4 py-3.5"
              >
                <div className="flex justify-between items-start gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2.5 flex-wrap">
                      <h3 className="font-display text-lg">{item.call_title}</h3>
                      {item.is_high_risk && (
                        <span className="text-[11px] font-medium border border-[#AC3A2A] text-[#AC3A2A] rounded-full px-2 py-0.5">
                          Escalation
                        </span>
                      )}
                      {item.status === "in_progress" && (
                        <span className="text-[11px] text-ink-45">in progress</span>
                      )}
                    </div>
                    <p className="text-[12px] text-ink-45 mt-0.5">
                      {item.agent_name || "Rep not set"} &middot; observed by{" "}
                      {item.reviewer_name ?? "unknown"} &middot;{" "}
                      {formatDate(item.submitted_at)}
                      {item.duration_ms ? ` · ${formatDuration(item.duration_ms)}` : ""}
                    </p>
                    {item.escalation_note && (
                      <p className="text-[13px] text-ink-70 mt-1.5">{item.escalation_note}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono text-[11.5px] text-ink-45">
                      {item.no_count > 0 ? `${item.no_count} flagged` : "none flagged"}
                    </span>
                    <span
                      className={`font-mono text-[11.5px] ${
                        item.days_waiting >= 3 ? "text-[#96690A]" : "text-ink-45"
                      }`}
                    >
                      {item.days_waiting < 1
                        ? "today"
                        : `${Math.floor(item.days_waiting)}d waiting`}
                    </span>
                    <button
                      onClick={() => void begin(item)}
                      disabled={starting === item.assignment_id}
                      className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium hover:opacity-85 disabled:opacity-40"
                    >
                      {starting === item.assignment_id
                        ? "Opening…"
                        : item.status === "in_progress"
                          ? "Continue"
                          : "Calibrate"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Figure({
  value,
  caption,
  warn = false,
}: {
  value: string;
  caption: string;
  warn?: boolean;
}): JSX.Element {
  return (
    <div className="py-4 pr-5 border-r border-rule-soft last:border-r-0">
      <span
        className="font-display text-3xl block leading-none mb-1.5"
        style={warn ? { color: "#96690A" } : undefined}
      >
        {value}
      </span>
      <span className="text-[12px] text-ink-45">{caption}</span>
    </div>
  );
}
