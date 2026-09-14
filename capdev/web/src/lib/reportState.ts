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

/** The canonical URL for a report, preserving nothing else from the address. */
export function reportUrl(request: ReportRequest): string {
  const params = new URLSearchParams();
  params.set(REPORT, request.kind === "executive" ? "executive" : "rep");
  if (request.kind === "representative") params.set(REP, request.repId);
  params.set(PERIOD, periodKey(request.period));
  return `${window.location.pathname}?${params.toString()}`;
}

/** Open a report: a new history entry, so Back returns to the application. */
export function pushReport(request: ReportRequest): void {
  window.history.pushState({}, "", reportUrl(request));
}

/**
 * Change the period WITHIN an open report.
 *
 * Replaces rather than pushes: three period changes while reading one report
 * should not become three Back presses before the reader is out of it.
 */
export function replaceReport(request: ReportRequest): void {
  window.history.replaceState({}, "", reportUrl(request));
}

/** Leave the report, returning the address bar to the plain application. */
export function clearReport(): void {
  window.history.pushState({}, "", window.location.pathname);
}

/** Back and Forward must move between the report and the application. */
export function onReportChange(handler: () => void): () => void {
  window.addEventListener("popstate", handler);
  return () => window.removeEventListener("popstate", handler);
}
