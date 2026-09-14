/**
 * What a month-on-month outcome SAYS, in one place (0079).
 *
 * Extracted from PerformanceOverview without changing a word. The Dashboard and
 * the reports have to use the same sentences — not similar ones — because the
 * whole claim of a report is that it is the same measurement in a different
 * presentation. Two copies of a seven-case switch is how "No comparable data
 * last month" on screen becomes "No comparison last month" on paper, and then
 * somebody has to work out whether they mean the same thing.
 *
 * Wording only. Nothing here decides an outcome; the outcomes are decided by
 * comparePercent / compareCount / compareStage in lib/dashboard.ts.
 */
import { formatCountDelta, formatPointDelta } from "@/lib/performance";
import { periodLabel, periodShortLabel, type Period } from "@/lib/period";
import type { Comparison, StageComparability } from "@/lib/dashboard";

export interface ComparisonText {
  text: string;
  /**
   * True when the line explains why there is no movement rather than stating
   * one. Presentation decides how to mark that; both surfaces currently mute it.
   */
  muted: boolean;
}

/**
 * Null means render NOTHING — not an em dash, not a placeholder.
 *
 * All time has no previous month, and a row of empty comparison lines under an
 * all-time view makes it look like a monthly view that failed to load.
 */
export function comparisonText(
  comparison: Comparison,
  selected: Period,
  previous: Period | null,
): ComparisonText | null {
  const vs = periodShortLabel(previous ?? selected, selected);
  switch (comparison.kind) {
    case "none":
      return null;
    case "delta":
      return {
        text: `${
          comparison.unit === "pts"
            ? formatPointDelta(comparison.value)
            : formatCountDelta(comparison.value)
        } vs ${vs}`,
        muted: false,
      };
    case "no-previous-month":
      return { text: "No previous-month comparison", muted: true };
    case "not-comparable-last-month":
      return { text: "No comparable data last month", muted: true };
    case "no-data-selected":
      return { text: `No data in ${periodLabel(selected)}`, muted: true };
    case "rubric-changed":
      return { text: "Rubric changed — not comparable", muted: true };
    case "unavailable":
      return { text: "Comparison unavailable", muted: true };
  }
}

/**
 * The single line under the Stage performance heading when the stages cannot be
 * compared, or null when they can (or when there is nothing to compare against).
 *
 * One line for the section rather than five copies under five meters: the reason
 * is a property of the period, not of any one stage.
 */
export function stageNoteText(gate: StageComparability, selected: Period): string | null {
  switch (gate.kind) {
    case "comparable":
    case "none":
      return null;
    case "rubric-changed":
      return "Rubric changed — not comparable";
    case "no-previous-month":
      return "No previous-month comparison";
    case "no-calibrated-previous":
      return "No comparable data last month";
    case "no-calibrated-selected":
      return `No calibrated stage data in ${periodLabel(selected)}`;
    case "no-data-selected":
      return `No data in ${periodLabel(selected)}`;
    case "unavailable":
      return "Comparison unavailable";
  }
}
