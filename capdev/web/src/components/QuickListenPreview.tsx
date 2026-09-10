import { useState } from "react";
import { requestQuickListen, type QuickListenOutcome } from "@/lib/quickListen";

/**
 * Quick Listen - the request control (0075 Phase 2).
 *
 * Phase 0 shipped this card with a mock state machine so the placement and
 * weight could be judged on a real call. The mock is gone: pressing Generate
 * now calls the quick-listen Edge Function, and every state shown below is a
 * real answer from the server.
 *
 * What has NOT arrived is audio. The function queues a digest and stops; no
 * script is written and no file is produced. So there is deliberately no player
 * here, and no control that looks like one. A "ready" digest is described as
 * prepared, never as playable, because claiming otherwise would be a lie the
 * user discovers by clicking.
 *
 * Two things carried over from Phase 0 and must stay:
 *
 *   1. Nothing renders at all below MIN_DURATION_MS. The server enforces the
 *      same 30-minute rule; this gate is the courtesy, that one is the rule.
 *
 *   2. This component never touches the original audio element. Evidence
 *      citations, moment clips and transcript follow-along are all anchored to
 *      the original recording's timeline, so when a Quick Listen player does
 *      arrive it will be a SEPARATE element. audioRef is not imported here and
 *      must not be.
 */

/** Quick Listen is for long calls. Below this it is not offered at all. */
export const MIN_DURATION_MS = 30 * 60 * 1000;

export function isQuickListenEligible(durationMs: number | null): boolean {
  return durationMs !== null && durationMs >= MIN_DURATION_MS;
}

type State =
  | { k: "idle" }
  | { k: "requesting" }
  | { k: "preparing"; digestId: string }
  | { k: "prepared"; digestId: string }
  | { k: "unavailable"; message: string }
  | { k: "error"; message: string };

export function QuickListenPreview({
  callId,
  durationMs,
  canGenerate,
}: {
  callId: string;
  durationMs: number | null;
  canGenerate: boolean;
}): JSX.Element | null {
  const [state, setState] = useState<State>({ k: "idle" });

  if (!isQuickListenEligible(durationMs)) return null;

  const minutes = Math.round((durationMs ?? 0) / 60000);

  async function generate(): Promise<void> {
    setState({ k: "requesting" });
    let outcome: QuickListenOutcome;
    try {
      outcome = await requestQuickListen(callId);
    } catch {
      setState({
        k: "error",
        message: "Quick Listen could not be reached. Please try again.",
      });
      return;
    }
    switch (outcome.kind) {
      case "preparing":
        setState({ k: "preparing", digestId: outcome.digestId });
        return;
      case "prepared":
        setState({ k: "prepared", digestId: outcome.digestId });
        return;
      case "unavailable":
        setState({ k: "unavailable", message: outcome.message });
        return;
      case "error":
        setState({ k: "error", message: outcome.message });
        return;
    }
  }

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

      {state.k === "idle" && (
        <>
          <p className="text-[13px] text-ink-70 mt-1.5">
            This {minutes}-minute call can be condensed into a shorter
            QA-focused listen.
          </p>
          {canGenerate ? (
            <button
              onClick={() => void generate()}
              className="mt-2.5 border border-ink bg-ink text-ground rounded px-3.5 py-1.5 text-[13px] font-medium hover:opacity-85"
            >
              Generate Quick Listen
            </button>
          ) : (
            // Shown rather than hidden: the card is part of the approved call
            // layout, and a reviewer who cannot generate should be told why the
            // button is absent instead of wondering where it went.
            <p className="text-[12.5px] text-ink-45 mt-2">
              Only Raw QA and QA Trainers can generate a Quick Listen.
            </p>
          )}
        </>
      )}

      {state.k === "requesting" && (
        <p className="text-[13px] text-ink-70 mt-1.5">Requesting Quick Listen&hellip;</p>
      )}

      {state.k === "preparing" && (
        <p className="text-[13px] text-ink-70 mt-1.5">
          Quick Listen is being prepared. You can leave this page and come back.
        </p>
      )}

      {state.k === "prepared" && (
        // Truthful, and deliberately not a control. The digest row exists; the
        // audio does not. Nothing here is clickable until a later phase writes
        // a storage path and a separate player is built for it.
        <p className="text-[13px] text-ink-70 mt-1.5">
          A Quick Listen has been prepared for this call. Playback is not
          available yet.
        </p>
      )}

      {(state.k === "unavailable" || state.k === "error") && (
        <>
          <p className="text-[13px] text-ink-70 mt-1.5">{state.message}</p>
          {state.k === "error" && canGenerate && (
            <button
              onClick={() => void generate()}
              className="mt-2.5 border border-rule rounded px-3.5 py-1.5 text-[13px] hover:bg-ground-2"
            >
              Try again
            </button>
          )}
        </>
      )}

      {/* Said once, quietly, and never absent. */}
      <p className="text-[11.5px] text-ink-45 mt-2">
        AI-condensed review aid &middot; Original remains source of truth.
        {state.k !== "idle" && state.k !== "requesting" && (
          <button
            onClick={() => setState({ k: "idle" })}
            className="underline underline-offset-2 ml-2 hover:text-ink-70"
          >
            Back
          </button>
        )}
      </p>
    </section>
  );
}
