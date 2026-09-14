import type React from "react";

/**
 * Report presentation primitives (0079).
 *
 * A REPORT IS A DOCUMENT, NOT A DASHBOARD SCREENSHOT. The Dashboard is built to
 * be scanned at a glance on a wide screen: cards, meters, colour used to draw
 * the eye. A report is read in sequence, on paper, by someone who was not in
 * the room — so this file deliberately shares no card component with dash.tsx.
 * Borrowing them would have produced a printed page of rounded boxes with grey
 * fills, which is what "a screenshot of the Dashboard" looks like.
 *
 * WHAT IT SHARES INSTEAD IS THE DATA. Every figure these components render
 * arrives already computed by the accepted 0078 helpers. Nothing here
 * calculates, rounds or interprets anything.
 *
 * COLOUR IS ALMOST ABSENT, and that is the design. Charcoal on white, one
 * accent rule under the masthead and one tick beside each section heading. The
 * brand is established by the logo; a document that repeats its colours down
 * every page reads as marketing, and this has to read as evidence. Nothing is
 * tinted by whether a number is good — the Dashboard does not do that either,
 * and a printed page cannot be hovered to find out what a colour meant.
 */

/* -------------------------------------------------------------------------- */
/* The logo                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The official Lioncrest mark, supplied by the business.
 *
 * NULL UNTIL THE REAL ASSET IS ADDED, deliberately. Drawing, tracing or
 * approximating a company's logo is not a placeholder, it is a wrong logo — and
 * a wrong logo on a document headed "official" is worse than no logo at all.
 * The masthead is built to work either way, so this file compiles and the
 * report reads correctly today; when the asset lands the change is two lines:
 *
 *   import lioncrestLogo from "@/assets/lioncrest-logo.png";
 *   const LOGO_SRC: string | null = lioncrestLogo;
 *
 * The mark is rendered with a fixed HEIGHT and width:auto, so whatever
 * proportions the supplied file has are preserved. It is never stretched to a
 * box and never recoloured.
 */
const LOGO_SRC: string | null = null;
const LOGO_ALT = "Lioncrest Digital Marketing Services Corp.";

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The sheet.
 *
 * On screen it is a page floating on a neutral ground, so the reader can see
 * what they are about to print. In print the ground, the shadow and the border
 * go: @page owns the margins, and a second set of padding here would push the
 * content into a narrower column than the one that was designed.
 */
export function ReportPage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="report-root min-h-screen bg-ground print:bg-white">
      <div className="report-sheet mx-auto bg-white text-ink">{children}</div>
    </div>
  );
}

/** Screen only. Never printed — a paper button is a smudge with an outline. */
export function ReportToolbar({
  onBack,
  onPrint,
  children,
}: {
  onBack: () => void;
  onPrint: () => void;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="report-toolbar print:hidden sticky top-0 z-10 bg-ground/95 backdrop-blur border-b border-rule-soft">
      <div className="report-sheet mx-auto flex items-center gap-3 flex-wrap py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="text-[12.5px] text-ink-70 hover:text-ink underline underline-offset-2"
        >
          &larr; Back
        </button>
        <div className="flex-1" />
        {children}
        <button
          type="button"
          onClick={onPrint}
          className="text-[12.5px] rounded-md border border-rule px-3 py-1.5 bg-card hover:bg-ground-2 text-ink"
        >
          Print / Save as PDF
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Masthead                                                                   */
/* -------------------------------------------------------------------------- */

export interface ScopeEntry {
  label: string;
  value: string;
}

/**
 * The official header, repeated on neither page but never split across two.
 *
 * The scope block under the rule is the part that makes this a record rather
 * than a printout: period, rubric versions represented, and the counts the
 * whole document is built from, stated before any percentage appears. A reader
 * who checks nothing else can see what the numbers cover.
 *
 * No environment badge, no deployment id, no database reference — those belong
 * to operating the application, not to the document it produced.
 */
export function ReportMasthead({
  title,
  subject,
  scope,
}: {
  title: string;
  subject?: string;
  scope: ScopeEntry[];
}): JSX.Element {
  return (
    <header className="report-masthead">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          {LOGO_SRC === null ? (
            // The wordmark carries the document until the asset is supplied.
            // It is typography, not an imitation of the mark.
            <p className="font-display text-[15px] leading-tight tracking-tight text-ink">
              LIONCREST
            </p>
          ) : (
            <img
              src={LOGO_SRC}
              alt={LOGO_ALT}
              className="report-logo"
              // Height fixed in CSS, width auto: the supplied proportions survive.
            />
          )}
          <p className="text-[11px] uppercase tracking-[0.13em] text-ink-70 mt-2">
            Lioncrest Digital Marketing Services Corp.
          </p>
        </div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-ink-45 pt-1">CapDev</p>
      </div>

      <div className="report-accent-rule" />

      <h1 className="font-display text-[26px] leading-tight tracking-tight mt-4">{title}</h1>
      {subject !== undefined && (
        <p className="font-display text-[19px] leading-tight text-ink-70 mt-1">{subject}</p>
      )}

      <dl className="report-scope">
        {scope.map((entry) => (
          <div key={entry.label} className="report-scope-entry">
            <dt>{entry.label}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A heading never prints alone at the foot of a page.
 *
 * `break-inside: avoid` on the section is the blunt instrument and it is right
 * for sections this size; `break-after: avoid` on the heading is the one that
 * matters when a section does have to split.
 */
export function ReportSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="report-section">
      <div className="flex items-baseline justify-between gap-4 flex-wrap report-section-head">
        <h2 className="report-section-title">{title}</h2>
        {note !== undefined && <p className="text-[11.5px] text-ink-45">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** A plain explanatory line. Used where a measure needs one sentence of care. */
export function ReportNote({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="text-[11.5px] text-ink-45 leading-snug mt-2">{children}</p>;
}

/* -------------------------------------------------------------------------- */
/* Figures                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One measured figure: label, value, the movement beneath it, then what it is
 * made of. Same reading order as the Dashboard card — value, comparison,
 * detail — because the two are meant to be recognisably the same figure.
 *
 * `movement` is a string the caller has already formatted. This component does
 * not know what a percentage point is, and should not.
 */
export function ReportFigure({
  label,
  value,
  movement,
  detail,
}: {
  label: string;
  value: string;
  movement?: string;
  detail?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="report-figure">
      <p className="report-figure-label">{label}</p>
      <p className="report-figure-value">{value}</p>
      {movement !== undefined && <p className="report-figure-movement">{movement}</p>}
      {detail !== undefined && <p className="report-figure-detail">{detail}</p>}
    </div>
  );
}

export function ReportFigureGrid({
  columns = 3,
  children,
}: {
  columns?: 2 | 3;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={columns === 2 ? "report-figures report-figures-2" : "report-figures"}>
      {children}
    </div>
  );
}

/**
 * Non-Negotiables, kept visually apart from the five stages.
 *
 * It is a pass rate over whole evaluations, not a ratio of criteria, and the
 * one thing this section must never do is look like a sixth stage — which is
 * exactly what happened on the Dashboard before 0077 gave it its own surface.
 * Here it gets its own bordered panel and its own heading.
 */
export function ReportPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="report-panel">
      <p className="report-panel-title">{title}</p>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

export interface Column {
  key: string;
  head: string;
  /** Numbers right-align; names and labels do not. */
  numeric?: boolean;
}

export function ReportTable({
  columns,
  children,
  caption,
}: {
  columns: Column[];
  children: React.ReactNode;
  caption?: string;
}): JSX.Element {
  return (
    // The scroller is a screen affordance only: a table whose columns cannot
    // fit a phone scrolls inside its own box rather than making the whole
    // report scroll sideways. Print resets the overflow so pagination and the
    // repeating header row behave normally on paper.
    <div className="report-table-scroll">
      <table className="report-table">
        {caption !== undefined && <caption className="report-table-caption">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric === true ? "num" : undefined}>
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Footer                                                                     */
/* -------------------------------------------------------------------------- */

export function ReportFooter(): JSX.Element {
  return (
    <footer className="report-footer">
      <p>Lioncrest Digital Marketing Services Corp. &middot; CapDev Performance Report</p>
    </footer>
  );
}

/**
 * Everything that went wrong, said plainly, with a way out.
 *
 * A report URL can name a period that does not parse, a representative who does
 * not exist, or a figure the reader is not allowed to see. None of those is a
 * reason to render a different report than the one that was asked for.
 */
export function ReportProblem({
  title,
  detail,
  onBack,
}: {
  title: string;
  detail: string;
  onBack: () => void;
}): JSX.Element {
  return (
    <div className="report-root min-h-screen bg-ground grid place-items-center px-6">
      <div className="max-w-md text-center">
        <h1 className="font-display text-[22px] tracking-tight">{title}</h1>
        <p className="text-[13px] text-ink-70 mt-2 leading-relaxed">{detail}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-5 text-[12.5px] rounded-md border border-rule px-3 py-1.5 bg-card hover:bg-ground-2"
        >
          Back to CapDev
        </button>
      </div>
    </div>
  );
}
