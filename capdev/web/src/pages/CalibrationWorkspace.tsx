import { useCallback, useEffect, useMemo, useState } from "react";
import { SubNav } from "@/components/AppShell";
import { getQueue, startCalibration, type QueueItem } from "@/lib/evaluation";
import { listPlaylists, getPlaylistContents, type PlaylistSummary, type PlaylistCall } from "@/lib/playlists";
import { formatDate, formatDuration } from "@/lib/format";

type Tab = "ready" | "playlists" | "inprogress";

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
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [contents, setContents] = useState<Record<string, PlaylistCall[]>>({});
  const [escalationsOnly, setEscalationsOnly] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [q, p] = await Promise.all([getQueue(), listPlaylists("raw_qa")]);
      setQueue(q);
      setPlaylists(p.filter((x) => x.call_count > 0));
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
  const oldest = waiting.length > 0 ? waiting[0]?.days_waiting ?? 0 : 0;

  /** Random pick, escalations first — the sampling a calibration session needs. */
  function pickRandom(): void {
    const pool = queue.filter((q) => q.status === "waiting");
    if (pool.length === 0) return;
    const escalated = pool.filter((q) => q.is_high_risk);
    const source = escalated.length > 0 ? escalated : pool;
    const choice = source[Math.floor(Math.random() * source.length)];
    if (choice) void begin(choice.raw_evaluation_id, choice.call_id);
  }

  async function toggle(id: string): Promise<void> {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!contents[id]) {
      setContents((c) => ({ ...c, [id]: [] }));
      setContents((c) => ({ ...c, [id]: [] }));
      const rows = await getPlaylistContents(id);
      setContents((c) => ({ ...c, [id]: rows }));
    }
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
          <Figure value={String(queue.filter((q) => q.status === "waiting").length)} caption="waiting" />
          <Figure value={String(inProgress.length)} caption="in progress" />
          <Figure value={String(escalations)} caption="escalations" warn={escalations > 0} />
          <Figure
            value={oldest < 1 ? "today" : `${Math.floor(oldest)}d`}
            caption="oldest waiting"
            warn={oldest >= 3}
          />
        </div>
      )}

      <SubNav
        tabs={[
          { key: "ready" as const, label: "Ready", count: waiting.length },
          { key: "playlists" as const, label: "By reviewer", count: playlists.length },
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
      ) : playlists.length === 0 ? (
        <Empty title="No completed reviews yet" body="Reviewers' weekly work appears here as they submit." />
      ) : (
        <ul className="space-y-2.5">
          {playlists.map((p) => (
            <li key={p.id} className="bg-card border border-rule-soft rounded">
              <button
                onClick={() => void toggle(p.id)}
                className="w-full px-4 py-3.5 flex justify-between items-center gap-4 text-left"
              >
                <div className="min-w-0">
                  <h3 className="font-display text-lg">{p.name}</h3>
                  <p className="text-[12px] text-ink-45 mt-0.5">
                    {p.call_count} review{p.call_count === 1 ? "" : "s"} &middot;{" "}
                    {p.calibrated_count} calibrated
                    {p.escalation_count > 0 && ` · ${p.escalation_count} escalation`}
                  </p>
                </div>
                <span className="text-[12px] text-ink-45 shrink-0">
                  {expanded === p.id ? "Hide" : "Open"}
                </span>
              </button>

              {expanded === p.id && (
                <ul className="border-t border-rule-soft divide-y divide-rule-soft">
                  {(contents[p.id] ?? []).map((c) => {
                    const done = c.calibration_status === "submitted";
                    return (
                      <li
                        key={c.call_id}
                        className="px-4 py-2.5 flex justify-between items-center gap-3 flex-wrap"
                      >
                        <span className="text-[13.5px] min-w-0">
                          {c.call_title}
                          {c.is_high_risk && (
                            <span className="text-[11px] text-[#AC3A2A] ml-2">escalation</span>
                          )}
                          {c.flagged_count ? (
                            <span className="text-[11px] text-ink-45 ml-2">
                              {c.flagged_count} flagged
                            </span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-3 shrink-0">
                          {done && (
                            <span className="font-mono text-[11.5px] text-ink-45">
                              {c.overall_score}%
                            </span>
                          )}
                          <button
                            onClick={() =>
                              done || !c.raw_evaluation_id
                                ? onOpenCall(c.call_id)
                                : void begin(c.raw_evaluation_id, c.call_id)
                            }
                            className={`rounded px-3 py-1 text-[12.5px] ${
                              done
                                ? "border border-rule hover:bg-ground-2"
                                : "bg-ink text-ground border border-ink hover:opacity-85"
                            }`}
                          >
                            {done ? "View" : "Calibrate"}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
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
