/**
 * Dashboard presentation primitives (0077 visual pass).
 *
 * Presentation only. Nothing here reads, derives or rounds a figure — every
 * value arrives already computed and every one of them is printed as text, so
 * a bar or a colour is never the only carrier of meaning.
 *
 * The rules these encode, once, so three files cannot drift apart:
 *
 *   - Section headings are readable sans-serif, not tiny heavily-tracked mono.
 *     Mono survives only where it earns its place: percentages, gaps, counts —
 *     figures the eye compares column-to-column.
 *   - One accent. `moss` marks the two headline scores and fills every meter;
 *     no per-stage hue, no rainbow, no gradient.
 *   - Cards are a hairline border on a near-white surface with generous
 *     padding and no shadow. Spacing separates sections, not chrome.
 */

/* -------------------------------------------------------------------------- */
/* Section heading                                                            */
/* -------------------------------------------------------------------------- */

export function SectionHeading({
  title,
  meta,
  children,
}: {
  title: string;
  /** Scope, stated once for the whole section rather than on every figure. */
  meta?: string;
  /** A control belonging to the section, right-aligned beside the meta. */
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3">
      <h2 className="font-sans text-[15px] font-semibold tracking-tight text-ink">
        {title}
      </h2>
      <div className="flex items-baseline gap-4">
        {meta && <span className="text-[12px] text-ink-45">{meta}</span>}
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

const CARD = "bg-card border border-rule-soft rounded-md";

/**
 * A count or a small percentage. Label first, then the number: the label is
 * what the eye needs in order to know what the number is, and a stack of
 * unlabelled numerals is the thing that makes a dashboard unreadable.
 */
export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}): JSX.Element {
  return (
    <div className={`${CARD} px-5 py-4`}>
      <p className="text-[12.5px] text-ink-45">{label}</p>
      <p className="font-display text-[30px] leading-none mt-2 tabular-nums text-ink">
        {value}
      </p>
      {detail && <p className="text-[12px] text-ink-45 mt-2">{detail}</p>}
    </div>
  );
}

/**
 * One of the two principal scores. Same information architecture as StatCard,
 * more room and the accent — so the eye finds these two first without anything
 * else on the page having to shout.
 */
export function ScoreCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}): JSX.Element {
  return (
    <div className={`${CARD} px-6 py-5`}>
      <p className="text-[12.5px] text-ink-70">{label}</p>
      <p className="font-display text-[44px] leading-none mt-2.5 tabular-nums text-moss-deep">
        {value}
      </p>
      {detail && <p className="text-[12px] text-ink-45 mt-2.5">{detail}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Meter                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A stage score: name, the percentage as text, then a bar.
 *
 * The bar is the redundant encoding, never the only one — the number sits
 * beside it and the sample size beneath it. A null percentage draws no track
 * at all rather than an empty one, because an empty bar reads as zero.
 */
export function Meter({
  label,
  pct,
  detail,
  cautioned = false,
}: {
  label: string;
  /** Already computed; null when the stage has never been scored. */
  pct: number | null;
  detail: string;
  /** Below the low-sample threshold — the caution is text, never colour. */
  cautioned?: boolean;
}): JSX.Element {
  const shown = pct === null ? null : Math.max(0, Math.min(100, pct));
  return (
    <div className={`${CARD} px-5 py-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13.5px] text-ink leading-snug">{label}</p>
        <p className="font-mono text-[15px] tabular-nums text-ink shrink-0">
          {pct === null ? "—" : `${Math.round(pct * 10) / 10}%`}
        </p>
      </div>
      {shown !== null && (
        <div
          className="mt-3 h-1.5 rounded-full bg-moss-soft overflow-hidden"
          role="presentation"
        >
          <div
            className="h-full rounded-full bg-moss"
            style={{ width: `${shown}%` }}
          />
        </div>
      )}
      <p className={`text-[11.5px] mt-2 ${cautioned ? "text-ink-70" : "text-ink-45"}`}>
        {detail}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend                                                                      */
/* -------------------------------------------------------------------------- */

export type Trend = "up" | "down" | "flat" | "unknown";

const TREND_LABEL: Record<Trend, string> = {
  up: "Improving",
  down: "Declining",
  flat: "Stable",
  unknown: "No trend yet",
};
const TREND_GLYPH: Record<Trend, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
  unknown: "·",
};
const TREND_TONE: Record<Trend, string> = {
  up: "text-moss",
  down: "text-clay",
  // Stable and unknown are deliberately neutral, and they are deliberately
  // different from each other: "no movement" and "we cannot say" are not the
  // same answer, and neither should read as a result.
  flat: "text-ink-70",
  unknown: "text-ink-45",
};

/**
 * Direction as a glyph AND a word wherever there is room for both, so the
 * meaning never rests on an arrow's angle or on colour alone. `compact` keeps
 * the glyph and moves the word into the tooltip.
 */
export function TrendTag({
  trend,
  compact = false,
  title,
}: {
  trend: Trend;
  compact?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 text-[12.5px] ${TREND_TONE[trend]}`}
      title={title ?? TREND_LABEL[trend]}
    >
      <span aria-hidden="true">{TREND_GLYPH[trend]}</span>
      {compact ? (
        <span className="sr-only">{TREND_LABEL[trend]}</span>
      ) : (
        <span>{TREND_LABEL[trend]}</span>
      )}
    </span>
  );
}
