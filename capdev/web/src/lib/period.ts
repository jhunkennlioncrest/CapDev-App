/**
 * The reporting period (0078-A).
 *
 * ONE period governs the whole performance story — the personal activity
 * counts, the shared department figures and the representative table. There is
 * no per-card period, deliberately: two periods on one page is how a reader
 * ends up comparing September with all time and believing the difference means
 * something.
 *
 * A MONTH IS A PHILIPPINE CALENDAR MONTH. Not the browser's month. The
 * database stores `submitted_at` as an absolute instant (timestamptz, UTC), so
 * "September" is only meaningful once a zone is named, and the zone has to be
 * the business's rather than the reader's — otherwise a manager in London and a
 * manager in Cebu open the same Dashboard and see different September figures.
 * That is the same reasoning 0071 applied to call dates, and it reuses the same
 * constant.
 *
 * BOUNDARIES ARE HALF-OPEN: [start, end). An assessment submitted at exactly
 * 2026-10-01 00:00 +08 belongs to October and to October only. `lte` on the
 * last day of the month is the classic off-by-one that either swallows or
 * duplicates the boundary instant, and with two adjacent months on screen a
 * duplicated record is visible arithmetic.
 */
import { BUSINESS_TIMEZONE } from "@/lib/format";

/**
 * `month` is 1-12, as a human writes it — not the 0-11 a Date constructor
 * takes. Every conversion to the Date form happens inside this module so the
 * off-by-one lives in one place.
 */
export type Period =
  | { kind: "month"; year: number; month: number }
  | { kind: "all" };

/**
 * Spelled out rather than taken from locale data, for the reason format.ts
 * already documents: CLDR abbreviations move between ICU versions, and a
 * period label that changes spelling between two browsers is a period label
 * two people cannot agree about. Nothing here is abbreviated, so this is
 * belt-and-braces — but it is free, and it keeps the month name a fact of this
 * file rather than of whichever ICU the reader happens to run.
 */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * How far the zone is ahead of UTC at a given instant, in milliseconds.
 *
 * Read from Intl rather than hardcoded to +08:00. The Philippines has no DST
 * today, but a constant offset is an assumption about a government's future
 * decisions, and the correct version costs three lines.
 */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Some ICU builds render midnight as hour 24 under hour12:false.
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asIfUtc - instantMs;
}

/**
 * The absolute instant at which a given wall-clock midnight occurs in the
 * business zone.
 *
 * Two passes, not one: the first tells us the offset in force near the target,
 * the second confirms it still holds at the corrected instant. That second
 * pass is what makes the function correct across a DST boundary rather than
 * merely correct in Manila.
 */
export function zonedMidnight(
  year: number,
  month: number,
  day: number,
  timeZone: string = BUSINESS_TIMEZONE,
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const first = zoneOffsetMs(wallAsUtc, timeZone);
  let instant = wallAsUtc - first;
  const second = zoneOffsetMs(instant, timeZone);
  if (second !== first) instant = wallAsUtc - second;
  return new Date(instant);
}

/** The month's half-open bounds as absolute instants. */
export function monthBounds(year: number, month: number): { start: Date; end: Date } {
  const start = zonedMidnight(year, month, 1);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = zonedMidnight(nextYear, nextMonth, 1);
  return { start, end };
}

/**
 * The ISO instants a query filters on, or null for all time.
 *
 * Callers apply these as `.gte("submitted_at", startIso).lt("submitted_at",
 * endIso)`. `lt`, never `lte`.
 */
export function periodRange(period: Period): { startIso: string; endIso: string } | null {
  if (period.kind === "all") return null;
  const { start, end } = monthBounds(period.year, period.month);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** Today's month, reckoned in the business zone — not in the reader's. */
export function currentMonthPeriod(now: Date = new Date()): Period {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { kind: "month", year: get("year"), month: get("month") };
}

/** "September 2026" / "All time". */
export function periodLabel(period: Period): string {
  if (period.kind === "all") return "All time";
  return `${MONTH_NAMES[period.month - 1]} ${period.year}`;
}

/**
 * What the period MEANS, in words, on the page — never in a tooltip.
 *
 * A percentage whose period is only discoverable by hovering is a percentage
 * most readers will never check.
 */
export function periodSentence(period: Period): string {
  if (period.kind === "all") return "Assessments submitted at any time";
  const { start, end } = monthBounds(period.year, period.month);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return `Assessments submitted 1–${days} ${MONTH_NAMES[period.month - 1]} ${
    period.year
  } (Philippine time)`;
}

/** Stable value for a <select> option and for React keys. */
export function periodKey(period: Period): string {
  return period.kind === "all"
    ? "all"
    : `${period.year}-${String(period.month).padStart(2, "0")}`;
}

export function periodFromKey(key: string): Period {
  if (key === "all") return { kind: "all" };
  const [y, m] = key.split("-");
  const year = Number(y);
  const month = Number(m);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return currentMonthPeriod();
  }
  return { kind: "month", year, month };
}

export function samePeriod(a: Period, b: Period): boolean {
  return periodKey(a) === periodKey(b);
}

/**
 * Every month from the earliest submission to the latest, newest first.
 *
 * Built from two timestamps, not from a list of evaluations: discovering which
 * months exist must not cost a read of every assessment ever submitted. Months
 * with no assessments inside that span are still offered — a quiet month is a
 * fact about the department, and hiding it would let a reader assume the gap
 * never happened.
 */
export function monthsInSpan(earliestIso: string | null, latestIso: string | null): Period[] {
  if (!earliestIso || !latestIso) return [];
  const first = currentMonthPeriodFromInstant(earliestIso);
  const last = currentMonthPeriodFromInstant(latestIso);
  if (first === null || last === null) return [];

  const out: Period[] = [];
  let { year, month } = last;
  // Descending, and bounded: a corrupt timestamp cannot spin this forever.
  for (let guard = 0; guard < 600; guard += 1) {
    out.push({ kind: "month", year, month });
    if (year === first.year && month === first.month) break;
    if (year < first.year || (year === first.year && month < first.month)) break;
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

function currentMonthPeriodFromInstant(iso: string): { year: number; month: number } | null {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const p = currentMonthPeriod(when);
  return p.kind === "month" ? { year: p.year, month: p.month } : null;
}
