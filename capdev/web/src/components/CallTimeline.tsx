import type { WorkflowStatus } from "@/lib/workflow";
import { WORKFLOW_STEPS, stageIndexFor } from "@/lib/workflow";

/**
 * Read-only workflow timeline.
 *
 * Present on every call so any role can see, without asking, where the call
 * sits and what happens next. Deliberately not interactive: status is derived
 * from artifacts, so clicking a stage could only ever lie about what exists.
 */
export function CallTimeline({ status }: { status: WorkflowStatus }): JSX.Element {
  const current = stageIndexFor(status);

  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5 py-1">
      {WORKFLOW_STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step.key} className="flex items-center gap-1">
            <span
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[12px] ${
                active
                  ? "bg-ink text-ground"
                  : done
                    ? "text-ink-70"
                    : "text-ink-45"
              }`}
            >
              <span aria-hidden className="font-mono text-[11px]">
                {done ? "✓" : active ? "●" : "○"}
              </span>
              {step.label}
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
  const isWaiting =
    status === "ready_for_raw_qa" || status === "waiting_for_calibration";
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
