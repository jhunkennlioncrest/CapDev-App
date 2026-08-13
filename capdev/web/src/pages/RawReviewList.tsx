import { useCallback, useEffect, useState } from "react";
import { getRawWorklist, type RawWorklistItem } from "@/lib/workflow";
import { formatDate, formatDuration } from "@/lib/format";
import { StatusPill } from "@/components/CallTimeline";

interface Props {
  onOpenCall: (id: string) => void;
  onBack: () => void;
}

/**
 * "My Raw Reviews" — calls waiting for observation.
 *
 * A filtered view over call.workflow_status, nothing more. The call owns the
 * lifecycle; this page only answers "what should I pick up next".
 */
export function RawReviewList({ onOpenCall, onBack }: Props): JSX.Element {
  const [items, setItems] = useState<RawWorklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setItems(await getRawWorklist());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = (items ?? []).filter((i) => i.workflow_status === "ready_for_raw_qa");
  const started = (items ?? []).filter((i) => i.workflow_status === "raw_qa_in_progress");

  return (
    <div className="max-w-5xl mx-auto px-6 pb-20">
      <header className="pt-8 pb-5 border-b border-rule">
        <button
          onClick={onBack}
          className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
        >
          &larr; All calls
        </button>
        <h1 className="font-display text-3xl mt-3">My raw reviews</h1>
        <p className="text-ink-70 text-[14px] mt-1 max-w-2xl">
          Calls ready to be observed. Record what you hear against each criterion
          &mdash; a trainer decides the outcome afterwards.
        </p>
      </header>

      {items !== null && items.length > 0 && (
        <div className="grid grid-cols-2 border-b border-rule">
          <Figure value={String(ready.length)} caption="ready to review" />
          <Figure value={String(started.length)} caption="started" />
        </div>
      )}

      {error && <p className="mt-5 text-[13px] text-[#AC3A2A]">{error}</p>}

      <div className="mt-7">
        {items === null ? (
          <p className="text-ink-45 text-sm">Loading&hellip;</p>
        ) : items.length === 0 ? (
          <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
            <h2 className="font-display text-2xl mb-2">Nothing to review</h2>
            <p className="text-ink-70 max-w-md mx-auto">
              Calls appear here once they have a transcript. Upload a recording
              from the dashboard to start one.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li
                key={item.call_id}
                className="bg-card border border-rule-soft rounded px-4 py-3.5 flex justify-between items-start gap-4 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <h3 className="font-display text-lg">{item.call_title}</h3>
                    <StatusPill status={item.workflow_status} />
                  </div>
                  <p className="text-[12px] text-ink-45 mt-0.5">
                    {item.agent_name || "Rep not set"} &middot; uploaded{" "}
                    {formatDate(item.uploaded_at)}
                    {item.duration_ms ? ` · ${formatDuration(item.duration_ms)}` : ""}
                    {item.reviewer_name && ` · started by ${item.reviewer_name}`}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`font-mono text-[11.5px] ${
                      item.has_transcript ? "text-ink-45" : "text-[#96690A]"
                    }`}
                  >
                    {item.has_transcript ? `${item.segment_count} lines` : "no transcript"}
                  </span>
                  <button
                    onClick={() => onOpenCall(item.call_id)}
                    disabled={!item.has_transcript}
                    title={item.has_transcript ? undefined : "This call needs a transcript first"}
                    className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium hover:opacity-85 disabled:opacity-40"
                  >
                    {item.draft_evaluation_id ? "Continue" : "Start raw QA"}
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
      <span className="font-display text-3xl block leading-none mb-1.5">{value}</span>
      <span className="text-[12px] text-ink-45">{caption}</span>
    </div>
  );
}
