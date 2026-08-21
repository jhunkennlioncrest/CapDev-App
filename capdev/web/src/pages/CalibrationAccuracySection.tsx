import { useCallback, useEffect, useState } from "react";
import {
  calibrationAccuracy,
  calibrationDisagreements,
  calibrationHotspots,
  type CalibrationAccuracy,
  type CalibrationComparison,
  type CalibrationHotspot,
} from "@/lib/performance";
import type { Session } from "@/lib/types";

/**
 * QA calibration — how closely reviewers track the trainer's final decisions.
 *
 * Deliberately its own section, separate from Representative Performance,
 * because they answer different questions. Representative performance says how
 * the rep is doing. This says how consistently the QA process reads the rubric.
 * Presenting them together as one number would make both meaningless.
 *
 * Never labelled "Raw QA score": a disagreement is not a mark against the
 * reviewer, it is a place two trained people saw a call differently.
 */
export function CalibrationAccuracySection({
  session,
  onOpenCall,
}: {
  session: Session;
  onOpenCall?: (callId: string) => void;
}): JSX.Element | null {
  const [rows, setRows] = useState<CalibrationAccuracy[] | null>(null);
  const [hotspots, setHotspots] = useState<CalibrationHotspot[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [disagreements, setDisagreements] = useState<CalibrationComparison[]>([]);

  // A reviewer sees their own figure; a trainer or manager sees the reviewers
  // they oversee. Both come from the same view, with RLS deciding.
  const isReviewerOnly =
    session.permissions.includes("raw_qa.submit") &&
    !session.permissions.includes("calibration.perform");

  const load = useCallback(async (): Promise<void> => {
    try {
      const [a, h] = await Promise.all([
        calibrationAccuracy(isReviewerOnly ? session.person.id : undefined),
        isReviewerOnly ? Promise.resolve([]) : calibrationHotspots(),
      ]);
      setRows(a);
      setHotspots(h);
    } catch {
      setRows([]);
    }
  }, [isReviewerOnly, session.person.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(reviewerId: string): Promise<void> {
    if (expanded === reviewerId) {
      setExpanded(null);
      return;
    }
    setExpanded(reviewerId);
    setDisagreements(await calibrationDisagreements(reviewerId));
  }

  if (rows === null) return null;

  return (
    <section className="mt-8">
      <div className="flex justify-between items-baseline gap-4 flex-wrap mb-1">
        <h2 className="font-display text-2xl">QA calibration</h2>
        <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
          {isReviewerOnly ? "your alignment" : "reviewer alignment"}
        </p>
      </div>
      <p className="text-[13px] text-ink-70 mb-3 max-w-2xl">
        How often a reviewer&rsquo;s observation matched the trainer&rsquo;s final
        decision. This is not the representative&rsquo;s score &mdash; a
        disagreement records where two people read the same call differently.
      </p>

      {rows.length === 0 ? (
        <div className="border border-dashed border-rule rounded bg-card px-5 py-6">
          <p className="text-[13.5px] text-ink-70">No completed calibrations yet.</p>
          <p className="text-[12.5px] text-ink-45 mt-1">
            Accuracy appears once a reviewer&rsquo;s observation has been
            calibrated and submitted.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.reviewer_id} className="bg-card border border-rule-soft rounded">
              <div className="px-4 py-3 flex justify-between items-center gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[14.5px]">
                    {isReviewerOnly ? "My calibration accuracy" : r.reviewer_name}
                  </p>
                  <p className="text-[12px] text-ink-45 mt-0.5">
                    {r.aligned} / {r.compared} aligned across {r.calibrations}{" "}
                    calibration{r.calibrations === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-display text-2xl leading-none tabular-nums">
                    {r.accuracy === null ? "—" : `${r.accuracy}%`}
                  </span>
                  {r.disagreements > 0 && (
                    <button
                      onClick={() => void toggle(r.reviewer_id)}
                      className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2"
                    >
                      {r.disagreements} disagreement{r.disagreements === 1 ? "" : "s"}
                    </button>
                  )}
                </div>
              </div>

              {/* The disagreements themselves: what each side decided and why
                  the trainer decided differently. Developmental, not punitive. */}
              {expanded === r.reviewer_id && (
                <ul className="border-t border-rule-soft divide-y divide-rule-soft">
                  {disagreements.map((d, i) => (
                    <li key={`${d.criterion_code}-${i}`} className="px-4 py-2.5">
                      <div className="flex items-baseline gap-2.5 flex-wrap">
                        <span className="font-mono text-[11px] text-ink-45">
                          {d.criterion_code}
                        </span>
                        <span className="text-[13px] flex-1 min-w-0">
                          {d.criterion_label}
                        </span>
                        <span className="font-mono text-[11.5px]">
                          <span className="text-ink-45">you</span>{" "}
                          {d.raw_value.toUpperCase()}
                          <span className="text-ink-45 mx-1.5">&rarr;</span>
                          <span className="text-ink-45">trainer</span>{" "}
                          {d.trainer_value.toUpperCase()}
                        </span>
                        {onOpenCall && (
                          <button
                            onClick={() => onOpenCall(d.call_id)}
                            className="text-[12px] text-accent underline underline-offset-2"
                          >
                            open
                          </button>
                        )}
                      </div>
                      {d.trainer_justification && (
                        <p className="text-[12.5px] text-ink-70 mt-1">
                          {d.trainer_justification}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Where the rubric itself is ambiguous, rather than who is wrong. */}
      {hotspots.length > 0 && (
        <div className="mt-3 border border-rule-soft rounded bg-card px-4 py-3">
          <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-2">
            Most disagreed criteria
          </p>
          <ul className="space-y-1">
            {hotspots.map((h) => (
              <li key={h.criterion_code} className="flex items-baseline gap-2.5">
                <span className="font-mono text-[11px] text-ink-45 w-12 shrink-0">
                  {h.criterion_code}
                </span>
                <span className="text-[13px] flex-1 min-w-0 truncate">
                  {h.criterion_label}
                </span>
                <span className="font-mono text-[11.5px] text-ink-45 shrink-0">
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
