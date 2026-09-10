import { useState } from "react";
import { formatDuration } from "@/lib/format";

/**
 * Quick Listen — PRESENTATION PREVIEW ONLY (0075 Phase 0).
 *
 * This component generates nothing. It writes nothing. It calls no service.
 * It exists so the placement, wording and weight of the feature can be judged
 * on a real call before any of the machinery behind it is built.
 *
 * The "Generate" button moves through a local, purely visual state so the
 * ready layout can be seen; nothing leaves the browser and nothing is stored.
 * Reloading the page returns it to the start.
 *
 * Two things here are real design decisions rather than placeholder, and both
 * are deliberate:
 *
 *   1. Quick Listen only appears on calls at or over MIN_DURATION_MS. It is a
 *      tool for long calls; on a ten-minute call it would cost money to save
 *      nobody any time, and an option that is never the right answer is just
 *      clutter.
 *
 *   2. The Quick Listen player is a SEPARATE audio element, never the original
 *      one. Evidence citations, moment clips and transcript follow-along are all
 *      anchored to the original recording's timeline — 44 evidence rows already
 *      are — so playing a shorter file through that element would silently seek
 *      every one of them to the wrong place. The real implementation will make
 *      those controls switch back to Original and seek there; this preview keeps
 *      the two players structurally apart so that stays possible.
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
  const [track, setTrack] = useState<"original" | "quick">("original");

  if (!isQuickListenEligible(durationMs)) return null;

  const minutes = Math.round((durationMs ?? 0) / 60000);
  // Roughly a sixth of the original, which is what a 7-10 minute digest of a
  // long call works out to. Illustrative only — the real duration comes from
  // the generated audio.
  const mockQuickMs = Math.round((durationMs ?? 0) / 6);

  return (
    <section className="mt-3 border border-rule-soft rounded bg-card px-4 py-3.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="font-display text-[15px]">AI Quick Listen</h2>
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 border border-rule-soft rounded-full px-2 py-0.5">
          Preview
        </span>
      </div>

      {state === "idle" && (
        <>
          <p className="text-[13px] text-ink-70 mt-1.5 max-w-2xl">
            This call is {minutes} minutes long. Create a shorter QA-focused
            version with the important conversations, decisions, risks and
            commitments.
          </p>
          <button
            onClick={() => {
              setState("generating");
              // Purely visual. No request is made and nothing is stored.
              window.setTimeout(() => {
                setState("ready");
                setTrack("quick");
              }, 1400);
            }}
            className="mt-2.5 bg-ink text-ground border border-ink rounded px-4 py-2 text-[13px] font-medium hover:opacity-85"
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
          {/* The ready layout: two named ways to hear the same call, the
              original first and always available. */}
          <div className="flex gap-2 mt-2.5 flex-wrap">
            <button
              onClick={() => setTrack("original")}
              className={`rounded px-3.5 py-1.5 text-[13px] border ${
                track === "original"
                  ? "bg-ink text-ground border-ink"
                  : "border-rule hover:bg-ground-2"
              }`}
            >
              Original &middot;{" "}
              <span className="font-mono">{formatDuration(durationMs)}</span>
            </button>
            <button
              onClick={() => setTrack("quick")}
              className={`rounded px-3.5 py-1.5 text-[13px] border ${
                track === "quick"
                  ? "bg-ink text-ground border-ink"
                  : "border-rule hover:bg-ground-2"
              }`}
            >
              AI Quick Listen &middot;{" "}
              <span className="font-mono">{formatDuration(mockQuickMs)}</span>
            </button>
          </div>

          <div className="mt-3 border border-dashed border-rule rounded px-3 py-4 text-center">
            <p className="text-[12.5px] text-ink-45">
              {track === "original"
                ? "The original player above stays where it is — this control only chooses which one you are listening to."
                : "The Quick Listen player will sit here, separate from the original."}
            </p>
          </div>
        </>
      )}

      {/* Said once, quietly, and always — not a banner, but never absent. */}
      <p className="text-[11.5px] text-ink-45 mt-2.5">
        AI-condensed review aid. The original recording remains the source of truth.
      </p>

      {state !== "idle" && (
        <button
          onClick={() => {
            setState("idle");
            setTrack("original");
          }}
          className="text-[11.5px] text-ink-45 underline underline-offset-2 mt-1.5"
        >
          Reset preview
        </button>
      )}
    </section>
  );
}
