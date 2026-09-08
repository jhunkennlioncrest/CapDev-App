/** Durations are stored in milliseconds throughout (Domain Blueprint §B). */
export function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "—";
  const mb = bytes / 1_048_576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * The business timezone for CapDev call dates (0071).
 *
 * A call's date is a property of the call, not of whoever is looking at it.
 * Two people in different countries must generate and read the same date in a
 * call title, so this is a fixed zone rather than the viewer's. It is the only
 * place the zone is named: nothing else in the client should hard-code it.
 *
 * The database renders the same instant in the same zone
 * (compute_call_identity, 0071), and the two renderings have to agree
 * character for character — the title's date segment is what the identity
 * guard compares against before it will rewrite a generated title.
 */
export const CALL_DATE_TIMEZONE = "Asia/Manila";

/**
 * Postgres to_char(..., 'Mon') abbreviations, spelled out rather than taken
 * from locale data.
 *
 * This is deliberate and it is not paranoia. Intl's en-GB "short" month is
 * CLDR data, and CLDR abbreviates September as "Sept", not "Sep": a browser on
 * current ICU renders "08 Sept 2026" where Postgres renders "08 Sep 2026".
 * One character is enough to make the date anchor stop matching, and a title
 * that stops matching silently stops being updated. Only the day, month number
 * and year are taken from Intl; the spelling comes from here.
 */
const PG_MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const CALL_DATE_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: CALL_DATE_TIMEZONE,
  day: "2-digit",
  month: "numeric",
  year: "numeric",
});

/**
 * A call's own date, as the business reckons it — the date segment of a call
 * title and any display of when the call happened.
 *
 * Use this for the call's date. Everything else on screen (submitted, updated,
 * last seen) is an application event, is correctly read in the reader's own
 * zone, and keeps using formatDate.
 */
export function formatCallDate(iso: string | null): string {
  if (!iso) return "—";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "—";
  const parts = CALL_DATE_PARTS.formatToParts(when);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const month = PG_MONTH_ABBREVIATIONS[Number(part("month")) - 1];
  if (!month) return "—";
  return `${part("day").padStart(2, "0")} ${month} ${part("year")}`;
}

/**
 * Reads duration from the audio file itself, in the browser, before upload.
 * Best-effort: some formats or codecs will not report it, and that is fine —
 * the column is nullable and the real value arrives with the transcript later.
 */
export function readAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number | null): void => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.addEventListener("loadedmetadata", () => {
      const seconds = audio.duration;
      done(Number.isFinite(seconds) ? Math.round(seconds * 1000) : null);
    });
    audio.addEventListener("error", () => done(null));
    setTimeout(() => done(null), 10_000);
    audio.src = url;
  });
}
