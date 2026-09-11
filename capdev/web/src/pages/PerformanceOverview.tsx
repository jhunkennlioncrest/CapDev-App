import { useEffect, useState } from "react";
import {
  sharedPerformance,
  LOW_SAMPLE,
  type SharedPerformance,
  type StageFigure,
} from "@/lib/dashboard";

/**
 * The shared performance picture (0077).
 *
 * The same numbers for every role that can see it. What differs by role is the
 * personal work above it, never the measurement — forking the calculation per
 * role would be the fastest way to end up with two departments disagreeing
 * about their own score.
 *
 * Raw QA sees Trainer stage performance here, deliberately. A reviewer who
 * cannot see where the calibrated assessment lands has no way to learn from it,
 * and calibration awareness is the point. Seeing a figure grants no authority
 * to change one: this component reads, and the permissions that govern
 * calibration, submission and management are untouched by it.
 *
 * Every figure states its scope. The heading carries it once — all time,
 * current active rubric — rather than repeating it on each number.
 */
export function PerformanceOverview(): JSX.Element | null {
  const [data, setData] = useState<SharedPerformance | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setData(await sharedPerformance());
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  if (failed) return null;
  if (data === null) return null;
  if (!data.rubricVersionId) return null;

  return (
    <section className="mt-8">
      <div className="flex justify-between items-baseline gap-4 mb-2.5">
        <h2 className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
          Performance
        </h2>
        <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-45">
          All time &middot; Rubric v{data.rubricLabel}
        </span>
      </div>

      {/* Work completion. Counts, not scores — kept visually apart from the
          percentages below so the two are never read as the same kind of
          number. */}
      {/* gap-px over a rule-coloured ground draws the separators, instead of a
          border on each cell. A per-cell border-r is only correct while the
          grid never wraps: at two columns the right-hand cell of every row but
          the last kept a rule floating at the card's edge. The gap follows the
          real grid at every breakpoint, and separates the wrapped rows too. */}
      <div className="bg-rule-soft border border-rule-soft rounded overflow-hidden grid gap-px grid-cols-2 sm:grid-cols-5">
        <Figure value={String(data.observedCount)} caption="Observed" detail="submitted Raw QA observations" />
        <Figure value={String(data.evaluatedCount)} caption="Evaluated" detail="submitted calibrated evaluations" />
        <Figure value={pct(data.observedPct)} caption="Observed %" detail="Raw QA, criteria met" />
        <Figure value={pct(data.evaluatedPct)} caption="Evaluated %" detail="QA Trainer, criteria met" />
        <Figure
          value={data.disagreements === null ? "—" : pct(data.disagreements.pct)}
          caption="Disagreements"
          detail={
            data.disagreements === null
              ? "restricted"
              : data.disagreements.comparisons === 0
                ? "no comparisons yet"
                : `${data.disagreements.comparisons} comparisons`
          }
        />
        {/* Five figures in two columns leave one slot empty, and the ground
            that draws the separators would show through it as a grey block.
            A blank card cell fills it. Only needed below sm: at five columns
            the row is exactly full, and the stage grid's six figures divide
            evenly into two, three and six. */}
        <div className="bg-card sm:hidden" aria-hidden="true" />
      </div>

      <h3 className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mt-6 mb-2.5">
        Stage performance
        <span className="ml-2 normal-case tracking-normal text-[11px]">
          QA Trainer scoring
        </span>
      </h3>
      <div className="bg-rule-soft border border-rule-soft rounded overflow-hidden grid gap-px grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {data.stages.map((s) => (
          <Figure key={s.key} value={pct(s.pct)} caption={s.label} detail={sample(s)} />
        ))}
        {/* Beside the stages, labelled differently, because it is a different
            kind of measurement. The Non-Negotiables are pass or fail — there is
            no 0-5 score behind this number and calling it a stage score would
            invite it to be averaged with ones that have. */}
        <Figure
          value={data.nonNegotiables === null ? "—" : pct(data.nonNegotiables.pct)}
          caption="Non-Negotiables pass rate"
          detail={
            data.nonNegotiables === null
              ? "no results yet"
              : sample({ n: data.nonNegotiables.n } as StageFigure)
          }
        />
      </div>
    </section>
  );
}

/** One decimal, and an em dash when there is genuinely nothing to show. */
function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 10) / 10}%`;
}

/**
 * A percentage without its sample size invites a reader to trust three
 * observations as much as three hundred, so the size is never optional.
 */
function sample(s: { n: number }): string {
  if (s.n === 0) return "no data yet";
  return s.n < LOW_SAMPLE ? `n=${s.n} · limited data` : `n=${s.n}`;
}

/**
 * The personal dashboard's Figure, with the separator moved to the grid.
 * Same type, same spacing, same three lines; only the rule is drawn elsewhere,
 * because that Figure lives in a grid that never wraps and these do not.
 */
function Figure({
  value,
  caption,
  detail,
}: {
  value: string;
  caption: string;
  detail?: string;
}): JSX.Element {
  return (
    <div className="bg-card px-5 py-4">
      <span className="font-display text-2xl block leading-none mb-1">{value}</span>
      <span className="text-[11.5px] text-ink-45 block">{caption}</span>
      {detail && <span className="text-[10.5px] text-ink-45 block mt-0.5">{detail}</span>}
    </div>
  );
}
