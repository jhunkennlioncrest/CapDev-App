import { useEffect, useState } from "react";
import {
  sharedPerformance,
  LOW_SAMPLE,
  type SharedPerformance,
} from "@/lib/dashboard";
import { SectionHeading, StatCard, ScoreCard, Meter } from "@/components/dash";

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
 *
 * The 0077 visual pass changed how this reads, not what it says. Three things
 * shape the layout now:
 *
 *   1. Volume and performance are separated. Observed, Evaluated and
 *      Disagreements are counts and a ratio — context. Raw QA and Trainer are
 *      the two scores the department is actually judged by, so they get their
 *      own row, more room and the accent. A five-across strip made a count of
 *      ten look like the equal of a 94.6% score.
 *
 *   2. Stages get horizontal room and a bar each. The labels are long and were
 *      wrapping to three lines in a six-column strip; a meter row fits the
 *      label, the number and the sample size on one line each.
 *
 *   3. Non-Negotiables leaves the stage grid entirely. It was the sixth cell in
 *      a five-stage row, which invited it to be read — and eventually averaged
 *      — as a stage score. It is a pass rate over evaluations, not a 0–5 mean
 *      over criteria, so it now sits in its own panel that says "Pass rate".
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

  const dis = data.disagreements;
  const nn = data.nonNegotiables;

  return (
    <>
      <section className="mt-10">
        <SectionHeading
          title="Team performance"
          meta={`All time · Rubric v${data.rubricLabel}`}
        />

        {/* Volume. Counts and a ratio, deliberately smaller than the scores
            below — they say how much work there is to judge, not how good it
            was. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            label="Observed"
            value={String(data.observedCount)}
            detail="submitted Raw QA observations"
          />
          <StatCard
            label="Evaluated"
            value={String(data.evaluatedCount)}
            detail="submitted calibrated evaluations"
          />
          <StatCard
            label="Disagreements"
            value={dis === null ? "—" : pct(dis.pct)}
            detail={
              dis === null
                ? "restricted"
                : dis.comparisons === 0
                  ? "no comparisons yet"
                  : `${dis.misaligned} of ${dis.comparisons} comparisons`
            }
          />
        </div>

        {/* The two principal scores. Same pooled arithmetic as before — these
            are rendered larger, not calculated differently — and kept apart
            from each other by name, because the whole point of 0077 is that
            Raw QA and Trainer are two assessments and never one blended one. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <ScoreCard
            label="Raw QA performance"
            value={pct(data.observedPct)}
            detail="criteria met, across submitted observations"
          />
          <ScoreCard
            label="Trainer performance"
            value={pct(data.evaluatedPct)}
            detail="criteria met, across calibrated evaluations"
          />
        </div>
      </section>

      <section className="mt-10">
        <SectionHeading title="Stage performance" meta="QA Trainer scoring" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.stages.map((s) => (
            <Meter
              key={s.key}
              label={s.label}
              pct={s.pct}
              detail={sample(s.n)}
              cautioned={s.n > 0 && s.n < LOW_SAMPLE}
            />
          ))}
        </div>

        {/* Its own panel, its own words. A pass rate over evaluations is a
            different kind of measurement from a mean of 0–5 stage scores, and
            the previous layout — sixth cell in the stage grid — said the
            opposite. Nothing about how it is computed has changed. */}
        <div className="bg-card border border-rule-soft rounded-md px-6 py-5 mt-3">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[13.5px] font-medium text-ink">Non-Negotiables</p>
              <p className="text-[12px] text-ink-45 mt-1">
                Pass or fail per evaluation — not a stage score
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-[30px] leading-none tabular-nums text-ink">
                {nn === null ? "—" : pct(nn.pct)}
                {nn !== null && (
                  <span className="font-sans text-[12.5px] text-ink-45 ml-2 align-middle">
                    Pass rate
                  </span>
                )}
              </p>
              <p className="text-[12px] text-ink-45 mt-2">
                {nn === null
                  ? "no results yet"
                  : `${nn.passed} of ${nn.n} evaluation${nn.n === 1 ? "" : "s"} passed`}
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
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
function sample(n: number): string {
  if (n === 0) return "No data yet";
  return n < LOW_SAMPLE ? `n=${n} · Limited data` : `n=${n}`;
}
