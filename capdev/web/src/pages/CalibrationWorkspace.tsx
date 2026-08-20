import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { SubNav } from "@/components/AppShell";
import { getQueue, startCalibration, type QueueItem } from "@/lib/evaluation";
import { formatDate, formatDuration } from "@/lib/format";

// The trainer's workspace answers one question: what should I calibrate next?
// Reviewer groupings are how a reviewer organises their own week — they are
// not the shape of the trainer's day, so they live in the Library instead.
type Tab = "ready" | "inprogress";

interface Props {
  onOpenCall: (id: string) => void;
}

/**
 * Calibration workspace.
 *
 * Two ways in, because trainers work two ways: pick the next thing off the
 * queue, or work through a reviewer's week. Both reach the same calibration —
 * there is no second evaluation and no duplicated work.
 */
export function CalibrationWorkspace({ onOpenCall }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>("ready");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [escalationsOnly, setEscalationsOnly] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedToday, setCompletedToday] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    try {
      const q = await getQueue();
      setQueue(q);
      // Throughput matters to a trainer deciding whether to keep going.
      const { data: counts } = await supabase
        .from("v_calibration_queue_counts")
        .select("completed_today")
        .maybeSingle<{ completed_today: number }>();
      setCompletedToday(counts?.completed_today ?? 0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function begin(rawEvaluationId: string, callId: string): Promise<void> {
    setStarting(rawEvaluationId);
    try {
      await startCalibration(rawEvaluationId);
      onOpenCall(callId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(null);
    }
  }

  const waiting = useMemo(
    () => queue.filter((q) => q.status === "waiting" && (!escalationsOnly || q.is_high_risk)),
    [queue, escalationsOnly],
  );
  const inProgress = useMemo(() => queue.filter((q) => q.status === "in_progress"), [queue]);
  const escalations = queue.filter((q) => q.is_high_risk && q.status === "waiting").length;

  /** Random pick, escalations first — the sampling a calibration session needs. */
  function pickRandom(): void {
    const pool = queue.filter((q) => q.status === "waiting");
    if (pool.length === 0) return;
    const escalated = pool.filter((q) => q.is_high_risk);
    const source = escalated.length > 0 ? escalated : pool;
    const choice = source[Math.floor(Math.random() * source.length)];
    if (choice) void begin(choice.raw_evaluation_id, choice.call_id);
  }

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <header className="pt-8 pb-5 flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Calibration</h1>
          <p className="text-ink-70 text-[14px] mt-1 max-w-xl">
            Everything the reviewer captured is already there. Confirm it, change
            what you disagree with, and decide the outcome.
          </p>
        </div>
        {queue.filter((q) => q.status === "waiting").length > 0 && (
          <button
            onClick={pickRandom}
            className="border border-rule rounded px-4 py-2 text-sm hover:bg-ground-2"
            title="Picks an escalation first, otherwise anything waiting"
          >
            Random review
          </button>
        )}
      </header>

      {queue.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 border-y border-rule mb-5">
          <Figure value={String(waiting.length)} caption="waiting" />
          <Figure value={String(inProgress.length)} caption="in progress" />
          <Figure value={String(completedToday)} caption="completed today" />
          <Figure value={String(escalations)} caption="escalations" warn={escalations > 0} />
        </div>
      )}

      <SubNav
        tabs={[
          { key: "ready" as const, label: "Ready", count: waiting.length },
          { key: "inprogress" as const, label: "In progress", count: inProgress.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {error && <p className="text-[13px] text-[#AC3A2A] mb-4">{error}</p>}

      {loading ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : tab === "ready" ? (
        <>
          {escalations > 0 && (
            <label className="flex items-center gap-2 text-[13px] mb-3">
              <input
                type="checkbox"
                checked={escalationsOnly}
                onChange={(e) => setEscalationsOnly(e.target.checked)}
              />
              Escalations only
            </label>
          )}
          {waiting.length === 0 ? (
            <Empty
              title="Nothing waiting"
              body="Submitted raw reviews appear here the moment a reviewer finishes one."
            />
          ) : (
            <ul className="space-y-2.5">
              {waiting.map((q) => (
                <QueueRow
                  key={q.assignment_id}
                  item={q}
                  starting={starting === q.raw_evaluation_id}
                  onStart={() => void begin(q.raw_evaluation_id, q.call_id)}
                />
              ))}
            </ul>
          )}
        </>
      ) : tab === "inprogress" ? (
        inProgress.length === 0 ? (
          <Empty title="Nothing in progress" body="Calibrations you've started but not submitted appear here." />
        ) : (
          <ul className="space-y-2.5">
            {inProgress.map((q) => (
              <QueueRow
                key={q.assignment_id}
                item={q}
                starting={starting === q.raw_evaluation_id}
                onStart={() => onOpenCall(q.call_id)}
                label="Continue"
              />
            ))}
          </ul>
        )
      ) : (
        <Empty
          title="Nothing in progress"
          body="Calibrations you have started appear here."
        />
      )}
    </div>
  );
}

function QueueRow({
  item,
  starting,
  onStart,
  label = "Calibrate",
}: {
  item: QueueItem;
  starting: boolean;
  onStart: () => void;
  label?: string;
}): JSX.Element {
  return (
    <li className="bg-card border border-rule-soft rounded px-4 py-3.5 flex justify-between items-start gap-4 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <h3 className="font-display text-lg">{item.call_title}</h3>
          {item.is_high_risk && (
            <span className="text-[11px] border border-[#AC3A2A] text-[#AC3A2A] rounded-full px-2 py-0.5">
              Escalation
            </span>
          )}
        </div>
        <p className="text-[12px] text-ink-45 mt-0.5">
          {item.agent_name || "Rep not set"} &middot; observed by {item.reviewer_name ?? "—"}{" "}
          &middot; {formatDate(item.submitted_at)}
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
          {item.days_waiting < 1 ? "today" : `${Math.floor(item.days_waiting)}d`}
        </span>
        <button
          onClick={onStart}
          disabled={starting}
          className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium hover:opacity-85 disabled:opacity-40"
        >
          {starting ? "Opening…" : label}
        </button>
      </div>
    </li>
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
    <div className="py-3.5 pr-5 border-r border-rule-soft last:border-r-0">
      <span
        className="font-display text-2xl block leading-none mb-1"
        style={warn ? { color: "#96690A" } : undefined}
      >
        {value}
      </span>
      <span className="text-[11.5px] text-ink-45">{caption}</span>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
      <h2 className="font-display text-2xl mb-2">{title}</h2>
      <p className="text-ink-70 max-w-md mx-auto">{body}</p>
    </div>
  );
}
