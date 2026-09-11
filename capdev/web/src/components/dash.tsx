/**
 * Dashboard presentation primitives (0077 visual pass).
 *
 * Presentation only. Nothing here reads, derives or rounds a figure — every
 * value arrives already computed and every one is printed as text, so a bar, a
 * chip or a colour is never the only carrier of meaning.
 *
 * Colour is spent, not sprinkled. `moss` marks the two headline scores, fills
 * every meter and means "improving"; `clay` means "declining". Nothing else on
 * this page is coloured, and in particular no figure is tinted by how large it
 * is — the data carries no threshold that would make green mean "good", and a
 * colour that asserts one would be inventing a judgement the rubric never made.
 */

/* -------------------------------------------------------------------------- */
/* Icons — small, inline, no dependency                                       */
/* -------------------------------------------------------------------------- */

type IconName =
  | "inbox" | "scales" | "check" | "clipboard" | "clock"
  | "bars" | "target" | "compare" | "shield";

const PATHS: Record<IconName, JSX.Element> = {
  inbox: <path d="M3 13h4l1.5 2.5h7L17 13h4M3 13l2.5-8h13L21 13v6H3v-6Z" />,
  scales: <path d="M12 4v16M7 8h10M6 8 3 15h6L6 8Zm12 0-3 7h6l-3-7Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  clipboard: <path d="M9 4h6v3H9V4Zm-3 3h12v13H6V7Z" />,
  clock: <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  bars: <path d="M5 20V11M12 20V4M19 20v-6" />,
  target: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />,
  compare: <path d="M8 5 4 12l4 7M16 5l4 7-4 7" />,
  shield: <path d="M12 3.5 19 6v6c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6l7-2.5Z" />,
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={`w-[18px] h-[18px] ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The chip an icon sits in. One recessive tint; `accent` for the two scores. */
function Chip({ name, accent = false }: { name: IconName; accent?: boolean }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${
        accent ? "bg-moss-soft text-moss-deep" : "bg-ground-2 text-ink-45"
      }`}
    >
      <Icon name={name} />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Section heading                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A quiet eyebrow rather than a headline: the section it labels is the thing
 * worth reading, and four competing headlines down a page is what made the
 * previous Dashboard tiring. Uppercase at modest tracking, not the 0.14em mono
 * it replaced.
 */
export function SectionHeading({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
      <h2 className="font-sans text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-45">
        {title}
      </h2>
      <div className="flex items-center gap-4">
        {meta && <span className="text-[12px] text-ink-45">{meta}</span>}
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

const CARD = "bg-card border border-rule-soft rounded-lg";

/**
 * One figure: chip, label, number, supporting line.
 *
 * `accent` is reserved for the two scores the department is judged by. It
 * tints the chip and the numeral and nothing else — it marks WHICH figures
 * matter most, never how good any figure is.
 */
export function StatCard({
  icon,
  label,
  value,
  detail,
  accent = false,
}: {
  icon: IconName;
  label: string;
  value: string;
  detail?: string;
  accent?: boolean;
}): JSX.Element {
  return (
    <div className={`${CARD} px-4 py-4 flex flex-col h-full`}>
      <div className="flex items-center gap-2.5">
        <Chip name={icon} accent={accent} />
        <p className="text-[12.5px] text-ink-70 leading-snug">{label}</p>
      </div>
      <p
        className={`font-display text-[30px] leading-none mt-3 tabular-nums ${
          accent ? "text-moss-deep" : "text-ink"
        }`}
      >
        {value}
      </p>
      {detail && <p className="text-[11.5px] text-ink-45 mt-2 leading-snug">{detail}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Meter                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A stage score: name, the percentage as text, a bar, the sample size.
 *
 * The bar is the redundant encoding, never the only one. A null percentage
 * draws no track at all rather than an empty one, because an empty bar reads
 * as zero.
 *
 * `distinct` is for Non-Negotiables, which is not a sixth stage: it is a pass
 * rate over evaluations, not a mean of 0–5 stage scores. It keeps the row's
 * shape so the eye can still compare, and changes its surface, its chip and
 * its footnote so nobody mistakes it for one.
 */
export function Meter({
  label,
  pct,
  detail,
  distinct = false,
}: {
  label: string;
  pct: number | null;
  detail: string;
  distinct?: boolean;
}): JSX.Element {
  const shown = pct === null ? null : Math.max(0, Math.min(100, pct));
  return (
    <div
      className={`rounded-lg px-4 py-4 flex flex-col h-full ${
        distinct ? "bg-moss-soft border border-moss/35" : `${CARD}`
      }`}
    >
      <div className="flex items-start gap-2 min-h-[2.4rem]">
        {distinct && (
          <span className="text-moss-deep shrink-0 mt-[1px]">
            <Icon name="shield" />
          </span>
        )}
        <p
          className={`text-[12.5px] leading-snug ${
            distinct ? "text-moss-deep font-medium" : "text-ink-70"
          }`}
        >
          {label}
        </p>
      </div>
      <p
        className={`font-display text-[26px] leading-none mt-1 tabular-nums ${
          distinct ? "text-moss-deep" : "text-ink"
        }`}
      >
        {pct === null ? "—" : `${Math.round(pct * 10) / 10}%`}
      </p>
      {shown !== null && (
        <div
          className={`mt-3 h-1.5 rounded-full overflow-hidden ${
            distinct ? "bg-card" : "bg-moss-soft"
          }`}
          role="presentation"
        >
          <div className="h-full rounded-full bg-moss" style={{ width: `${shown}%` }} />
        </div>
      )}
      <p className="text-[11px] text-ink-45 mt-2 leading-snug">{detail}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend                                                                      */
/* -------------------------------------------------------------------------- */

export type Trend = "up" | "down" | "flat" | "none";

const TREND_LABEL: Record<Trend, string> = {
  up: "Improving",
  down: "Declining",
  flat: "Stable",
  none: "No calibrated evaluations yet",
};
const TREND_GLYPH: Record<Trend, string> = {
  up: "↑", down: "↓", flat: "→", none: "—",
};
const TREND_TONE: Record<Trend, string> = {
  up: "text-moss",
  down: "text-clay",
  flat: "text-ink-70",
  none: "text-ink-45",
};

/**
 * Glyph AND word, so direction never rests on an arrow's angle or a colour.
 *
 * "none" is the exception and deliberately so: with no calibrated evaluation
 * there is no direction to name, so the cell is an em dash and the explanation
 * lives in the tooltip and in screen-reader text rather than in a phrase
 * repeated down every empty row.
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
      {compact || trend === "none" ? (
        <span className="sr-only">{TREND_LABEL[trend]}</span>
      ) : (
        <span>{TREND_LABEL[trend]}</span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Roster bits                                                                */
/* -------------------------------------------------------------------------- */

/** Initials, so a long roster has something to anchor on while scanning. */
export function Avatar({ name }: { name: string }): JSX.Element {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-ground-2
                 text-[10.5px] font-medium text-ink-45 shrink-0"
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

/** A switch that says what it does in words as well as in position. */
export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="inline-flex items-center gap-2.5 text-[12px] text-ink-45 hover:text-ink"
    >
      <span
        className={`relative inline-block w-8 h-[18px] rounded-full transition-colors ${
          on ? "bg-moss" : "bg-rule"
        }`}
      >
        <span
          className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-card transition-all ${
            on ? "left-[16px]" : "left-[2px]"
          }`}
        />
      </span>
      {label}
    </button>
  );
}
