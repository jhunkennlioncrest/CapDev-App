import { useCallback, useEffect, useState } from "react";
import { SectionHeading } from "@/components/dash";
import {
  calibrationHotspotsForPeriod,
  formatPercent,
  type CalibrationHotspotResult,
} from "@/lib/performance";
import { periodLabel, type Period } from "@/lib/period";
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
 * card is gone. Team performance already carries the department's alignment
 * rate for the same period, computed from the same comparison data, and two
 * numbers answering one question on one page is how a reader ends up trusting
 * neither. What is left is the part Team performance cannot say: WHICH criteria
 * the disagreements land on.
 *
 * 0078-A: THE SELECTED PERIOD GOVERNS THIS SECTION TOO. It was the last part of
 * the performance story still answering all-time while everything around it
 * answered September — a list of criteria from calls nobody in the period had
 * calibrated, sitting under a September heading. The period is the page's, not
 * this section's: there is no selector here and there must never be one.
 */
export function CalibrationAccuracySection({
  session,
  period,
}: {
  session: Session;
  /** The one selected period, owned by the page. */
  period: Period;
}): JSX.Element | null {
  const [result, setResult] = useState<CalibrationHotspotResult | null>(null);
  const [failed, setFailed] = useState(false);

  // A reviewer sees their own alignment; a trainer or manager sees the
  // reviewers they oversee. The view scopes itself — RLS decides, not this.
  const isReviewerOnly =
    session.permissions.includes("raw_qa.submit") &&
    !session.permissions.includes("calibration.perform");
  /**
   * The exact predicate the database applies to this data:
   * can_see_all_calibration_accuracy() is has_permission('calibration.perform').
   *
   * Mirrored here for two reasons. An empty result can then be reported as what
   * it actually is rather than as "no disagreements" — the view returns zero
   * rows to a caller without the permission, not an error, so emptiness alone
   * cannot tell the two apart. And the read is not issued at all for a role
   * that may not see the answer, so this section shows exactly the audience it
   * showed before.
   */
  const canSeeHotspots = session.permissions.includes("calibration.perform");

  const load = useCallback(async (): Promise<void> => {
    if (!canSeeHotspots) {
      setResult(null);
      setFailed(false);
      return;
    }
    try {
      setResult(await calibrationHotspotsForPeriod(period));
      setFailed(false);
    } catch {
      // A failed read is not a finding. It must not render as "no
      // disagreements", which would be a claim about the department's
      // calibration quality made from a query that never returned.
      setResult(null);
      setFailed(true);
    }
  }, [canSeeHotspots, period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (canSeeHotspots && result === null && !failed) return null;

  const where = period.kind === "all" ? "all submitted calibrations" : `${periodLabel(period)} calibrations`;
  const rows = result?.rows ?? [];
  const showVersions = (result?.versions.length ?? 0) > 1;

  return (
    <section className="mt-8">
      <SectionHeading
        title="QA calibration"
        meta={isReviewerOnly ? "Your alignment" : "Reviewer alignment"}
      />

      {/* The period, in words and on the page. A criteria list whose scope can
          only be discovered by hovering is a list most readers will read as
          "always". */}
      <p className="text-[12px] text-ink-45 -mt-1 mb-3 leading-snug">
        Based on {where}
      </p>

      <div className="bg-card border border-rule-soft rounded-lg px-5 py-4">
        {/* FOUR STATES, and they are four different sentences. Restricted is
            not zero; nothing compared is not zero; a measured zero is a real
            result; and a failed read is none of the three. */}
        {!canSeeHotspots ? (
          <>
            <p className="text-[13.5px] text-ink-70">
              Disagreement detail is restricted for your role.
            </p>
            <p className="text-[12.5px] text-ink-45 mt-1">
              The department&rsquo;s overall alignment rate is in Team
              performance above.
            </p>
          </>
        ) : failed ? (
          <p className="text-[13.5px] text-ink-70">
            Disagreement detail could not be loaded.
          </p>
        ) : (result?.comparisons ?? 0) === 0 ? (
          <>
            <p className="text-[13.5px] text-ink-70">
              No comparison data for {period.kind === "all" ? "any submitted calibration" : periodLabel(period)}.
            </p>
            <p className="text-[12.5px] text-ink-45 mt-1">
              Criteria appear here once an observation has been calibrated and
              the two assessments differ.
            </p>
          </>
        ) : rows.length === 0 ? (
          <>
            <p className="text-[13.5px] text-ink-70">
              {period.kind === "all"
                ? "No disagreements recorded across submitted calibrations."
                : `No disagreements recorded for ${periodLabel(period)}.`}
            </p>
            <p className="text-[12.5px] text-ink-45 mt-1">
              {result?.comparisons} criterion{" "}
              {result?.comparisons === 1 ? "comparison" : "comparisons"}, and
              Raw QA and the Trainer agreed on every one.
            </p>
          </>
        ) : (
          <>
            <p className="text-[12.5px] text-ink-70 mb-3">Most disagreed criteria</p>
            {/* Each row stacks below sm. The count used to read "2/4 · 50%",
                which fit beside a wrapping label on a phone; the sentence that
                replaced it does not — and a shrink-0 span beside a min-w-0 one
                does not overflow, it OVERLAPS, which no overflow check catches.
                So the row is a column until there is width for two. */}
            <ul className="divide-y divide-rule-soft">
              {rows.map((h) => (
                <li
                  key={h.criterion_id}
                  className="py-2 first:pt-0 last:pb-0 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3"
                >
                  <span className="flex items-baseline gap-3 min-w-0 sm:flex-1">
                    <span className="font-mono text-[11px] text-ink-45 w-12 shrink-0">
                      {h.criterion_code}
                    </span>
                    {/* Wraps rather than truncates. A criterion cut to
                        "Appropriate Sales H..." is unusable on a phone, and this
                        list exists to name the criterion. */}
                    <span className="text-[13.5px] flex-1 min-w-0 text-ink leading-snug">
                      {h.criterion_label}
                      {/* Only when the period actually spans versions. Two
                          versions can carry the same code for different
                          questions, and they are separate rows here — the label
                          says which is which rather than leaving the reader to
                          assume a duplicate. */}
                      {showVersions && h.version_label && (
                        <span className="text-[11.5px] text-ink-45 ml-2">
                          v{h.version_label}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="text-[12px] tabular-nums text-ink-45 pl-[3.75rem] sm:pl-0 sm:shrink-0 sm:text-right">
                    Disagreed in {h.disagreements} of {h.compared}{" "}
                    {h.compared === 1 ? "calibration" : "calibrations"} &middot;{" "}
                    {formatPercent(h.disagreement_rate)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
