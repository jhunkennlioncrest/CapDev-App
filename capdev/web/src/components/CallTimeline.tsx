import { useEffect, useState } from "react";
import type { WorkflowStatus } from "@/lib/workflow";
import { WORKFLOW_STEPS, stageIndexFor } from "@/lib/workflow";
import { supabase } from "@/lib/supabase";

export interface TimelineFacts {
  uploaded_at: string | null;
  uploaded_by: string | null;
  transcribed_at: string | null;
  transcribed_by: string | null;
  transcript_kind: string | null;
  raw_qa_at: string | null;
  raw_qa_by: string | null;
  calibrated_at: string | null;
  calibrated_by: string | null;
  published_at: string | null;
  published_by: string | null;
}

/** "20 Aug" — enough to place a stage without crowding the line. */
function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fullMoment(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

/**
 * Read-only workflow timeline.
 *
 * Shows only a date per completed stage; who did it and at what time appear on
 * hover. The history is available without a second panel demanding attention —
 * most of the time nobody needs it, and when they do they need it precisely.
 *
 * Deliberately not interactive: status is derived from artifacts, so clicking a
 * stage could only ever lie about what exists.
 */
export function CallTimeline({
  status,
  callId,
}: {
  status: WorkflowStatus;
  callId?: string;
}): JSX.Element {
  const current = stageIndexFor(status);
  const [facts, setFacts] = useState<TimelineFacts | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    if (!callId) return;
    let cancelled = false;
    void supabase
      .from("v_call_timeline")
      .select(
        "uploaded_at, uploaded_by, transcribed_at, transcribed_by, transcript_kind, raw_qa_at, raw_qa_by, calibrated_at, calibrated_by, published_at, published_by",
      )
      .eq("call_id", callId)
      .maybeSingle<TimelineFacts>()
      .then(({ data }) => {
        if (!cancelled) setFacts(data);
      });
    return () => {
      cancelled = true;
    };
  }, [callId]);

  /** Maps a workflow step to the artifact that completed it. */
  function factsFor(key: string): { at: string | null; by: string | null; verb: string } {
    switch (key) {
      case "uploaded":
        return { at: facts?.uploaded_at ?? null, by: facts?.uploaded_by ?? null, verb: "Uploaded" };
      case "transcript":
        return {
          at: facts?.transcribed_at ?? null,
          by: facts?.transcribed_by ?? null,
          verb: facts?.transcript_kind === "machine" ? "Transcribed" : "Transcript added",
        };
      case "raw_qa":
        return { at: facts?.raw_qa_at ?? null, by: facts?.raw_qa_by ?? null, verb: "Raw QA submitted" };
      case "calibration":
        return {
          at: facts?.calibrated_at ?? null,
          by: facts?.calibrated_by ?? null,
          verb: "Calibration completed",
        };
      case "published":
        return { at: facts?.published_at ?? null, by: facts?.published_by ?? null, verb: "Published" };
      default:
        return { at: null, by: null, verb: "" };
    }
  }

  return (
    <ol className="flex flex-wrap items-start gap-x-1 gap-y-1.5 py-1">
      {WORKFLOW_STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const f = factsFor(step.key);
        const moment = fullMoment(f.at);
        const showTip = hovered === step.key && Boolean(f.at);

        return (
          <li key={step.key} className="flex items-center gap-1">
            <span
              className="relative"
              onMouseEnter={() => setHovered(step.key)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(step.key)}
              onBlur={() => setHovered(null)}
              tabIndex={f.at ? 0 : -1}
            >
              <span
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[12px] ${
                  active ? "bg-ink text-ground" : done ? "text-ink-70" : "text-ink-45"
                } ${f.at ? "cursor-help" : ""}`}
              >
                <span aria-hidden className="font-mono text-[11px]">
                  {done ? "✓" : active ? "●" : "○"}
                </span>
                {step.label}
                {done && f.at && (
                  <span
                    className={`font-mono text-[10.5px] ${
                      active ? "text-ground/70" : "text-ink-45"
                    }`}
                  >
                    {shortDate(f.at)}
                  </span>
                )}
              </span>

              {showTip && (
                <span
                  role="tooltip"
                  className="absolute left-0 top-full mt-1 z-20 whitespace-nowrap bg-ink text-ground rounded px-3 py-2 shadow-lg"
                >
                  <span className="block text-[12px] font-semibold">{f.verb}</span>
                  <span className="block font-mono text-[11px] text-ground/75 mt-0.5">
                    {moment.date} &middot; {moment.time}
                  </span>
                  {f.by && (
                    <span className="block text-[11.5px] text-ground/75 mt-0.5">
                      by {f.by}
                    </span>
                  )}
                </span>
              )}
            </span>

            {i < WORKFLOW_STEPS.length - 1 && (
              <span aria-hidden className="text-rule text-[11px]">
                —
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Compact single-line variant for list rows. */
export function StatusPill({ status }: { status: WorkflowStatus }): JSX.Element {
  const step = WORKFLOW_STEPS[stageIndexFor(status)];
  const isWaiting = status === "ready_for_raw_qa" || status === "waiting_for_calibration";
  const isDone = status === "completed" || status === "published";

  return (
    <span
      className={`text-[11px] border rounded-full px-2 py-0.5 whitespace-nowrap ${
        isDone
          ? "border-[#1F7A4D] text-[#1F7A4D]"
          : isWaiting
            ? "border-[#96690A] text-[#96690A]"
            : "border-rule text-ink-45"
      }`}
    >
      {step?.label ?? status}
    </span>
  );
}
