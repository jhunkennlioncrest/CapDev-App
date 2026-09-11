import { useCallback, useEffect, useState } from "react";
import { SectionHeading } from "@/components/dash";
import { calibrationHotspots, type CalibrationHotspot } from "@/lib/performance";
import type { Session } from "@/lib/types";

/**
 * QA calibration — where the rubric itself is read two ways.
 *
 * Deliberately its own section, separate from Representative Performance,
 * because they answer different questions. Representative performance says how
 * the rep is doing. This says which CRITERIA the QA process disagrees about.
 *
 * Never labelled "Raw QA score": a disagreement is not a mark against the
 * reviewer, it is a place two trained people saw a call differently.
 *
 * This used to lead with a per-reviewer alignment card — accuracy percentage,
 * aligned-of-compared, a disagreement count — above the criteria list. That
 * card is gone. Team performance already carries the department's alignment as
 * "Disagreements 1.9% · 2 of 105 comparisons", computed from the same
 * comparison data, and two numbers answering one question on one page is how a
 * reader ends up trusting neither. What is left is the part Team performance
 * cannot say: WHICH criteria the disagreements land on.
 *
 * Nothing about how a disagreement is counted changed, and
 * v_calibration_comparison is untouched — this component simply stopped
 * reading the two of its three sources it no longer displays.
 */
export function CalibrationAccuracySection({
  session,
}: {
  session: Session;
}): JSX.Element | null {
  const [hotspots, setHotspots] = useState<CalibrationHotspot[] | null>(null);

  // A reviewer sees their own alignment; a trainer or manager sees the
  // reviewers they oversee. The view scopes itself — RLS decides, not this.
  const isReviewerOnly =
    session.permissions.includes("raw_qa.submit") &&
    !session.permissions.includes("calibration.perform");

  const load = useCallback(async (): Promise<void> => {
    try {
      setHotspots(await calibrationHotspots());
    } catch {
      setHotspots([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (hotspots === null) return null;

  return (
    <section className="mt-8">
      <SectionHeading
        title="QA calibration"
        meta={isReviewerOnly ? "Your alignment" : "Reviewer alignment"}
      />

      {hotspots.length === 0 ? (
        <div className="bg-card border border-rule-soft rounded-lg px-5 py-4">
          <p className="text-[13.5px] text-ink-70">No disagreements recorded yet.</p>
          <p className="text-[12.5px] text-ink-45 mt-1">
            Criteria appear here once an observation has been calibrated and the
            two assessments differ.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-rule-soft rounded-lg px-5 py-4">
          <p className="text-[12.5px] text-ink-70 mb-3">Most disagreed criteria</p>
          <ul className="divide-y divide-rule-soft">
            {hotspots.map((h) => (
              <li key={h.criterion_code} className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0">
                <span className="font-mono text-[11px] text-ink-45 w-12 shrink-0">
                  {h.criterion_code}
                </span>
                {/* Wraps rather than truncates. A criterion cut to "Appropriate
                    Sales H..." is unusable on a phone, and this list exists to
                    name the criterion. */}
                <span className="text-[13.5px] flex-1 min-w-0 text-ink leading-snug">
                  {h.criterion_label}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-ink-45 shrink-0">
                  {h.disagreements}/{h.compared} &middot; {h.disagreement_rate}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
