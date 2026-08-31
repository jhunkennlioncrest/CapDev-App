import type { StageCeiling, TrainerStage } from "@/lib/calibration";

/**
 * The 0-5 stage score.
 *
 * A single NO on this stage's checklist caps it at 2. The capped buttons are
 * disabled rather than hidden, and the reason is stated: a Trainer who cannot
 * award 4 needs to know it is the checklist doing that, not a broken control.
 *
 * NA does not cap. That distinction is made in v_stage_checklist_status, which
 * counts only no_items, so nothing here needs to reason about it.
 */
export function StageScorePicker({
  stage,
  ceiling,
  value,
  onPick,
}: {
  stage: TrainerStage | undefined;
  ceiling: StageCeiling | undefined;
  value: number | undefined;
  onPick: (stage: TrainerStage, score: number) => Promise<void>;
}): JSX.Element | null {
  // A checklist stage with no mapping is not part of the Trainer rubric.
  if (!stage) return null;

  const max = ceiling?.max_score ?? 5;
  const capped = max === 2;

  return (
    <span className="flex items-center gap-2 shrink-0">
      {capped && (
        <span
          className="text-[11px] text-[#96690A]"
          title="The rubric caps a stage at 2 when any checklist item is No. Items marked N/A do not cap."
        >
          Capped at 2 &mdash; one checklist item is No.
        </span>
      )}
      <span className="flex gap-0.5">
        {[0, 1, 2, 3, 4, 5].map((n) => {
          const blocked = n > max;
          const chosen = value === n;
          return (
            <button
              key={n}
              onClick={() => void onPick(stage, n)}
              disabled={blocked}
              title={
                blocked
                  ? "Not available while a checklist item for this stage is No"
                  : SCORE_MEANING[n]
              }
              className={[
                "w-6 h-6 text-[12px] rounded border transition-colors",
                chosen
                  ? "bg-ink text-ground border-ink font-medium"
                  : blocked
                    ? "border-rule-soft text-ink-45 opacity-35 cursor-not-allowed"
                    : "border-rule text-ink-70 hover:border-ink hover:text-ink",
              ].join(" ")}
            >
              {n}
            </button>
          );
        })}
      </span>
    </span>
  );
}

/** The rubric's own words for each point on the scale. */
const SCORE_MEANING: Record<number, string> = {
  0: "Not Done - the stage did not happen at all",
  1: "Poor - most checklist items No, barely executed",
  2: "Weak - clear gaps, or delivery confused the author",
  3: "Acceptable - all items Yes, but delivery undercut it",
  4: "Strong - all items Yes, minor delivery issue",
  5: "Flawless - all items Yes, delivered naturally and confidently",
};
