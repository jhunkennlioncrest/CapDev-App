/**
 * When an in-flight Quick Listen digest is presumed dead (0075 Phase 2).
 *
 * Separated from the handler for one reason: this is the decision that can kill
 * work someone is paying for, and a decision like that should be runnable and
 * assertable outside the Edge Runtime. Nothing here touches the network or the
 * database.
 */

import { canonicalTimestampMicros } from "./fingerprint.ts";

/**
 * How long an in-flight digest may hold the slot before it is presumed dead.
 *
 * call_digest_one_in_flight_per_call admits ONE queued-or-running row per call.
 * That is the right guard - it is what stops two people billing a provider
 * twice - but without an expiry it is also a permanent lock: a worker that
 * crashes between 'queued' and 'ready' leaves a live row, and every future
 * request for that call is refused for ever.
 *
 * The numbers are chosen against the platform, not by feel. Supabase Edge
 * Functions have a wall-clock ceiling on the worker itself: 150s on the free
 * plan, 400s on paid, and that ceiling covers background tasks
 * (EdgeRuntime.waitUntil) too. A worker cannot outlive it.
 *
 *   QUEUED - nothing has claimed the row. Whatever claims it in Phase 3 will do
 *   so either in the same invocation (immediately) or from a sweep. Fifteen
 *   minutes is far longer than either needs, and expiring a queued row is
 *   nearly free: no provider call has been made, so nothing is thrown away.
 *
 *   RUNNING - a worker said it was working, and 0075 Phase 3A settled what that
 *   worker is: ONE EdgeRuntime.waitUntil task inside the request's own isolate.
 *   Such a worker cannot outlive the wall clock, so ten minutes is 1.5x the
 *   400s paid ceiling and about four times the 150s free one - safe under
 *   either plan without having to know which this project is on. It was thirty
 *   minutes when the execution shape was still open and a chain of workers was
 *   possible; against a single worker that only meant a dead job held the call
 *   hostage for twenty-three minutes longer than it had to.
 *
 *   The asymmetry that set it still holds: expiring too early destroys work
 *   that has already spent provider money, expiring too late only makes a
 *   reviewer wait. Ten minutes keeps a wide margin over the ceiling rather than
 *   hugging it. If Phase 3B moves condensation to a queue drained across
 *   several invocations, this has to go back up.
 *
 * Recovery is request-triggered only: no cron, no sweeper. A call nobody asks
 * about again keeps its stale row indefinitely, which costs nothing, because
 * the only harm a stale row does is block a request that is not being made.
 */
export const STALE_QUEUED_MS = 15 * 60 * 1000;
export const STALE_RUNNING_MS = 10 * 60 * 1000;

export interface InFlightTimings {
  status: string;
  requested_at: string;
  started_at: string | null;
}

/**
 * How far past its timeout an in-flight digest is, or null if it is still
 * within it (and so still legitimately working).
 *
 * A row whose timestamp cannot be parsed is treated as NOT stale. Refusing to
 * expire something we cannot date is the safe direction: the cost is a slot
 * that stays held, the alternative is killing live work on a guess.
 *
 * A 'running' row with no started_at falls back to requested_at, which can only
 * make it look older, never younger - so the fallback cannot cause an early
 * expiry, only a slightly earlier one for a row that was mislabelled anyway.
 */
export function staleMillis(
  d: InFlightTimings,
  nowMs: number,
): number | null {
  const running = d.status === "running";
  const limit = running ? STALE_RUNNING_MS : STALE_QUEUED_MS;
  const stamp = running ? (d.started_at ?? d.requested_at) : d.requested_at;

  let startedMs: number;
  try {
    const micros = canonicalTimestampMicros(stamp);
    if (micros === null) return null;
    startedMs = Number(BigInt(micros) / 1000n);
  } catch {
    return null;
  }

  const age = nowMs - startedMs;
  return age > limit ? age - limit : null;
}

/** The column whose timestamp decided staleness, for the compare-and-swap. */
export function stalenessColumn(d: InFlightTimings): "started_at" | "requested_at" {
  return d.status === "running" && d.started_at ? "started_at" : "requested_at";
}
