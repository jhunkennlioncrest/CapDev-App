/**
 * Where a report lives in the URL (0079).
 *
 * THE APPLICATION HAS NO ROUTER. `react-router-dom` is in package.json and is
 * imported nowhere; navigation is React state in App.tsx and the address bar
 * never changes. 0079 does not introduce one — a report is the first thing in
 * CapDev worth linking to, and that is not a reason to re-plumb five
 * workspaces, three overlays and a sub-view through a routing framework.
 *
 * SO: the query string, read once at mount and pushed with the History API.
 * That gives the three things a report actually needs — it survives a refresh,
 * it can be sent to someone, and the browser Back button behaves — without
 * anything else in the application learning about URLs.
 *
 * NOT THE HASH, deliberately and permanently. lib/accountSetup.ts runs first at
 * module load and reads the hash to catch Supabase invite and recovery links
 * before detectSessionInUrl strips them; that race is load-bearing and is
 * documented as such. A report that wrote to the hash would eventually write
 * over somebody's password-setup link.
 */
import { periodKey, tryPeriodFromKey, type Period } from "@/lib/period";

export type ReportRequest =
  | { kind: "executive"; period: Period }
  | { kind: "representative"; repId: string; period: Period };

/**
 * A URL that names a report but cannot be honoured.
 *
 * Kept as a value rather than thrown away, because the alternative is to
 * substitute something plausible — this month, the first representative — and
 * hand the reader a document that answers a question they did not ask. The
 * report view renders the reason and a way back.
 */
export interface ReportRequestError {
  kind: "invalid";
  reason: string;
}

const REPORT = "report";
const PERIOD = "period";
const REP = "id";

/** Loose shape check only. Whether the id EXISTS is the data layer's answer. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Null means "this URL is not asking for a report" — the ordinary application.
 * An error object means "it is asking, and the request is malformed".
 */
export function readReportFromUrl(
  search: string = window.location.search,
): ReportRequest | ReportRequestError | null {
  const params = new URLSearchParams(search);
  const report = params.get(REPORT);
  if (report === null) return null;

  const periodParam = params.get(PERIOD);
  if (periodParam === null) {
    return { kind: "invalid", reason: "This report link has no reporting period." };
  }
  const period = tryPeriodFromKey(periodParam);
  if (period === null) {
    return {
      kind: "invalid",
      reason: `"${periodParam}" is not a reporting period. Expected "all" or a month such as "2026-09".`,
    };
  }

  if (report === "executive") return { kind: "executive", period };

  if (report === "rep") {
    const repId = params.get(REP);
    if (repId === null || repId === "") {
      return { kind: "invalid", reason: "This report link does not say which representative it is for." };
    }
    if (!UUID.test(repId)) {
      return { kind: "invalid", reason: "This report link's representative reference is not valid." };
    }
    return { kind: "representative", repId, period };
  }

  return {
    kind: "invalid",
    reason: `"${report}" is not a report type. Expected "executive" or "rep".`,
  };
}

/**
 * The canonical URL for a report. The query string is this module's to own and
 * is rewritten wholesale; everything else in the address is carried through.
 *
 * THE HASH IS CARRIED, NOT DROPPED. It belongs to lib/accountSetup.ts, which
 * reads Supabase invite and recovery links out of it at module load. Building
 * an address without it does not leave the hash alone -- it deletes it, which
 * is exactly the thing this package promised never to do. Reading it here and
 * writing it back unchanged is the whole of "not touching" it.
 */
export function reportUrl(request: ReportRequest): string {
  const params = new URLSearchParams();
  params.set(REPORT, request.kind === "executive" ? "executive" : "rep");
  if (request.kind === "representative") params.set(REP, request.repId);
  params.set(PERIOD, periodKey(request.period));
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`;
}

/**
 * How many history entries deep into reports this entry is.
 *
 * Stored ON the history entry rather than in a module variable, because the
 * browser owns the thing being counted. A module counter goes wrong the moment
 * the reader presses Back or Forward themselves — it keeps counting while the
 * browser moves the cursor underneath it. An entry's own state travels with it,
 * survives a reload, and is restored on Back, so it cannot drift.
 *
 * Absent or zero means "this entry is not a report this tab opened" — either
 * the application itself, or a report URL loaded cold from a link.
 */
interface ReportHistoryState {
  capdevReportDepth?: number;
}

function reportDepth(): number {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null) return 0;
  const depth = (state as ReportHistoryState).capdevReportDepth;
  if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 1) return 0;
  return depth;
}

function stateAtDepth(depth: number): ReportHistoryState {
  return depth > 0 ? { capdevReportDepth: depth } : {};
}

/** Open a report: a new history entry, so Back returns to the application. */
export function pushReport(request: ReportRequest): void {
  window.history.pushState(stateAtDepth(reportDepth() + 1), "", reportUrl(request));
}

/**
 * Change the period WITHIN an open report.
 *
 * Replaces rather than pushes: three period changes while reading one report
 * should not become three Back presses before the reader is out of it.
 *
 * The entry keeps its depth. Replacing changes what an entry says, never where
 * it sits, so the way out from it is unchanged.
 */
export function replaceReport(request: ReportRequest): void {
  window.history.replaceState(stateAtDepth(reportDepth()), "", reportUrl(request));
}

/**
 * Leave the report.
 *
 * GOING BACK IS NOT THE SAME AS NAVIGATING TO WHERE BACK WOULD LAND. Pushing
 * the application's own URL would leave the reader at
 * application -> report -> application, where their next Back press reopens the
 * report they just closed. So when this tab opened the report, this rewinds
 * history by exactly the number of report entries it added, landing on the
 * application entry the reader came from and leaving nothing behind to return
 * to. `onReportChange` hears the popstate and the view follows the URL.
 *
 * A report loaded cold — a copied link, a new tab — has no application entry
 * behind it to rewind to, and `history.back()` there would take the reader off
 * the site entirely. That case REPLACES the address instead: the reader lands
 * in the application, and Back still means whatever it meant before they
 * arrived.
 *
 * The hash is left exactly as found. lib/accountSetup.ts owns it, and an exit
 * path is no place to delete somebody's invite link.
 */
export function clearReport(): void {
  const depth = reportDepth();
  if (depth > 0) {
    window.history.go(-depth);
    return;
  }
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
}

/** Back and Forward must move between the report and the application. */
export function onReportChange(handler: () => void): () => void {
  window.addEventListener("popstate", handler);
  return () => window.removeEventListener("popstate", handler);
}
