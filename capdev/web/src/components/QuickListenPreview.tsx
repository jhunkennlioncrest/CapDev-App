import { useState } from "react";
import { formatDuration } from "@/lib/format";

/**
 * Quick Listen — PRESENTATION PREVIEW ONLY (0075 Phase 0).
 *
 * This generates nothing, writes nothing and calls no service. It exists so the
 * placement, wording and weight of the feature can be judged on a real call
 * before any of the machinery behind it is built. The Generate button moves
 * through local state so the finished layout can be seen; reloading resets it.
 *
 * Contained as a small card of its own, and everything it offers stays inside
 * that card. An earlier draft floated the Generate button out to the right edge,
 * where it lined up with the page-level actions (Delete, Record observations,
 * Review & correct) and read as a fourth thing to do with the call rather than
 * as an option belonging to the recording above it. The card is deliberately
 * tight — compact padding, one helper line — so it stays an aside.
 *
 * Two things here are real design decisions, not placeholder:
 *
 *   1. Nothing renders at all below MIN_DURATION_MS. Quick Listen is for long
 *      calls; on a ten-minute call it would cost money to save nobody any time,
 *      and an option that is never the right answer is only clutter.
 *
 *   2. The finished Quick Listen player will be a SEPARATE audio element, never
 *      the original one. Evidence citations, moment clips and transcript
 *      follow-along are all anchored to the original recording's timeline — 44
 *      evidence rows already are — so playing a shorter file through that
 *      element would silently seek every one of them to the wrong place. This
 *      component never touches audioRef, and must not start.
 */

/** Quick Listen is for long calls. Below this it is not offered at all. */
export const MIN_DURATION_MS = 30 * 60 * 1000;

export function isQuickListenEligible(durationMs: number | null): boolean {
  return durationMs !== null && durationMs >= MIN_DURATION_MS;
}

type PreviewState = "idle" | "generating" | "ready";

export function QuickListenPreview({
  durationMs,
}: {
  durationMs: number | null;
}): JSX.Element | null {
  const [state, setState] = useState<PreviewState>("idle");

  if (!isQuickListenEligible(durationMs)) return null;

  const minutes = Math.round((durationMs ?? 0) / 60000);
  // Roughly a sixth of the original, which is about what a 7-10 minute digest
  // of a long call works out to. ILLUSTRATIVE ONLY — no audio exists, and the
  // real duration will come from the generated file. Shown so the finished
  // card can be judged at a realistic width.
  const mockQuickMs = Math.round((durationMs ?? 0) / 6);

  return (
    <section className="mt-3 border border-rule-soft rounded bg-card px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
          AI Quick Listen
        </span>
        <span className="font-mono text-[9.5px] tracking-[0.12em] uppercase text-ink-45 border border-rule-soft rounded-full px-1.5">
          Preview
        </span>
      </div>

      {state === "idle" && (
        <>
          <p className="text-[13px] text-ink-70 mt-1.5">
            This {minutes}-minute call can be condensed into a shorter
            QA-focused listen.
          </p>
          <button
            onClick={() => {
              // Purely visual. No request is made and nothing is stored.
              setState("generating");
              window.setTimeout(() => setState("ready"), 1200);
            }}
            className="mt-2.5 border border-ink bg-ink text-ground rounded px-3.5 py-1.5 text-[13px] font-medium hover:opacity-85"
          >
            Generate Quick Listen
          </button>
        </>
      )}

      {state === "generating" && (
        <p className="text-[13px] text-ink-70 mt-1.5">
          Building Quick Listen&hellip; you can leave this page and come back.
        </p>
      )}

      {state === "ready" && (
        <>
          <p className="text-[13px] text-ink-70 mt-1.5">
            <span className="font-mono">{formatDuration(mockQuickMs)}</span>{" "}
            condensed from{" "}
            <span className="font-mono">{formatDuration(durationMs)}</span>
          </p>
          {/* Not a button. No condensed audio exists yet, and a control that
              looks playable and does nothing reads as broken rather than as a
              preview. Inert until Phase 4 gives it something to play. */}
          <span
            aria-disabled="true"
            className="mt-2.5 inline-block border border-dashed border-rule text-ink-45 bg-ground-2 rounded px-3.5 py-1.5 text-[13px] cursor-not-allowed select-none"
          >
            Play Quick Listen &middot; Preview only
          </span>
        </>
      )}

      {/* Said once, quietly, and never absent. */}
      <p className="text-[11.5px] text-ink-45 mt-2">
        AI-condensed review aid &middot; Original remains source of truth.
        {state !== "idle" && (
          <button
            onClick={() => setState("idle")}
            className="underline underline-offset-2 ml-2 hover:text-ink-70"
          >
            Reset preview
          </button>
        )}
      </p>
    </section>
  );
}
