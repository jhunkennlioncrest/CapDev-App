import { useEffect, useState } from "react";
import {
  sharedPerformance,
  LOW_SAMPLE,
  type SharedPerformance,
} from "@/lib/dashboard";
import { SectionHeading, StatCard, Meter } from "@/components/dash";

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
      <section className="mt-8">
        <SectionHeading
          title="Team performance"
          meta={`All time · Rubric v${data.rubricLabel}`}
        />

        {/* Five figures in one row, volume then the two scores then alignment.
            The scores carry the accent so the eye finds them first; nothing
            here is tinted by how large it is.

            Observed Score and Calibrated Score are the REPRESENTATIVES'
            performance as measured by two different assessment sources. They
            are not a Raw QA reviewer's score and not a QA Trainer's score —
            the old "Raw QA performance" / "Trainer performance" captions read
            as though they were, which is why they are gone. Same pooled
            arithmetic as before, renamed only. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard
            icon="clipboard"
            label="Observed"
            value={String(data.observedCount)}
            detail="submitted Raw QA observations"
          />
          <StatCard
            icon="clock"
            label="Evaluated"
            value={String(data.evaluatedCount)}
            detail="submitted calibrated evaluations"
          />
          <StatCard
            icon="bars"
            accent
            label="Observed Score"
            value={pct(data.observedPct)}
            detail="Criteria met across submitted Raw QA observations"
          />
          <StatCard
            icon="target"
            accent
            label="Calibrated Score"
            value={pct(data.evaluatedPct)}
            detail="Criteria met across submitted QA Trainer evaluations"
          />
          {/* Not tinted red. 1.9% is a low disagreement rate — a good result —
              and colouring it as an alarm would assert the opposite. */}
          <StatCard
            icon="compare"
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
      </section>

      <section className="mt-8">
        <SectionHeading title="Stage performance" meta="QA Trainer scoring" />

        {/* Six cells, and the sixth is deliberately not a stage. Non-Negotiables
            keeps the row's shape so the eye can still compare left to right,
            and changes surface, chip and footnote so it cannot be mistaken for
            — or averaged with — a 0–5 stage score. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {data.stages.map((s) => (
            <Meter key={s.key} label={s.label} pct={s.pct} detail={sample(s.n)} />
          ))}
          <Meter
            distinct
            label="Non-Negotiables"
            pct={nn === null ? null : nn.pct}
            detail={
              nn === null
                ? "No results yet"
                : `${nn.passed} of ${nn.n} evaluation${nn.n === 1 ? "" : "s"} passed`
            }
          />
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
