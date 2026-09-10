import { useCallback, useEffect, useState } from "react";
import { RISK_CATEGORIES, risksForCall, type RiskContext, type RiskRecord } from "@/lib/risk";
import { formatDate } from "@/lib/format";

/**
 * The permanent risk & escalation record, read-only (0074).
 *
 * A risk outlives the evaluation that raised it. Until now the only place it
 * could be read was inside the calibration form, so closing that form made the
 * narrative disappear — the badge on a list said a risk existed and nothing on
 * any screen said what it was.
 *
 * This is presentation only. Raising and determining stay in RiskFlag, where
 * the permission checks and the mutations belong; RiskFlag renders
 * RiskRecordDetail for the display half so the two can never drift apart.
 *
 * Source of truth is risk_record, read through v_call_risks. Never
 * evaluation.escalation_note, which is a lossy mirror of the first risk's
 * opening note and carries no category, determination or resolution.
 */

export const CATEGORY_LABEL = Object.fromEntries(
  RISK_CATEGORIES.map((c) => [c.value, c.label]),
) as Record<string, string>;

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}

/**
 * One record, in full and read-only: what was seen, who raised it, what the
 * trainer decided, and where it stands now. Every field is shown when present;
 * nothing is summarised away.
 */
type DeterminationState = "awaiting" | "valid" | "escalation" | "not_a_risk";

/**
 * The state a reader can actually trust.
 *
 * risk_record has two independent notions of progress: `determination`, which
 * is the trainer's judgement, and `status`, which is lifecycle resolution. They
 * are genuinely separate concepts — a risk can be judged valid and escalated
 * and still be unresolved — but CapDev has no complete resolve/close workflow
 * yet, so in practice `status` sits at 'open' on records the trainer has fully
 * determined. Rendering "open" beside "Escalation required" told the reader
 * nothing true about where the risk stands, so it is not rendered at all.
 *
 * Determination is the primary visible state until lifecycle resolution is a
 * real workflow. Nothing about the underlying columns changes.
 */
function determinationState(risk: RiskRecord): DeterminationState {
  if (risk.determination === null) return "awaiting";
  if (risk.determination === "not_a_risk") return "not_a_risk";
  return risk.requires_escalation ? "escalation" : "valid";
}

const DETERMINATION_LABEL: Record<DeterminationState, string> = {
  awaiting: "Awaiting determination",
  valid: "Valid risk",
  escalation: "Escalation required",
  not_a_risk: "Not a risk",
};

const DETERMINATION_TONE: Record<DeterminationState, string> = {
  awaiting: "border-[#96690A] text-[#96690A]",
  valid: "border-rule text-ink-70",
  escalation: "border-[#AC3A2A] text-[#AC3A2A]",
  not_a_risk: "border-rule-soft text-ink-45",
};

export function RiskRecordDetail({ risk }: { risk: RiskRecord }): JSX.Element {
  const raisedBy =
    risk.identified_by && risk.identified_by !== risk.identified_by_role
      ? `${risk.identified_by} (${risk.identified_by_role})`
      : risk.identified_by_role;

  return (
    <>
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className="text-[12px] border border-rule rounded-full px-2 py-0.5">
          {categoryLabel(risk.category)}
        </span>
        <span className="text-[12px] text-ink-45">
          Raised by {raisedBy} &middot; {formatDate(risk.identified_at)}
        </span>
        <span className={`text-[11px] rounded-full px-2 py-0.5 border ml-auto ${DETERMINATION_TONE[determinationState(risk)]}`}>
          {DETERMINATION_LABEL[determinationState(risk)]}
        </span>
      </div>

      {/* The opening observation, in the raiser's own words. A determination
          sits beside it and never replaces it. */}
      {risk.note ? (
        <p className="text-[13px] mt-1">{risk.note}</p>
      ) : (
        <p className="text-[13px] mt-1 text-ink-45">No note was written.</p>
      )}

      {risk.determination && (
        <p className="text-[12.5px] text-ink-70 mt-1">
          <span className="font-semibold">Determined</span>
          {risk.determined_by && ` by ${risk.determined_by}`}
          {risk.determined_at && ` · ${formatDate(risk.determined_at)}`}
          {risk.determination_note && ` — ${risk.determination_note}`}
        </p>
      )}

      {/* Both classifications, so a disagreement reads as one. */}
      {risk.was_reclassified && risk.original_category && (
        <p className="text-[11.5px] text-ink-45 mt-0.5">
          Raw QA called this {categoryLabel(risk.original_category)}
        </p>
      )}

      {/* No lifecycle resolution is shown here — not status, not resolved_by,
          not the resolution note. Those columns are untouched in the database
          and will be surfaced once there is a real resolve/close workflow
          behind them. (0074) */}
    </>
  );
}

/** The records on one call, undetermined first — those are still someone's job. */
export function RiskRecordList({ risks }: { risks: RiskRecord[] }): JSX.Element | null {
  if (risks.length === 0) return null;
  const undetermined = risks.filter((r) => r.determination === null);
  const settled = risks.filter((r) => r.determination !== null);
  return (
    <>
      {undetermined.length > 0 && (
        <ul className="divide-y divide-rule-soft">
          {undetermined.map((r) => (
            <li key={r.id} className="py-2.5">
              <RiskRecordDetail risk={r} />
            </li>
          ))}
        </ul>
      )}
      {settled.length > 0 && (
        <div className={undetermined.length > 0 ? "mt-3 border-t border-rule-soft pt-3" : ""}>
          {undetermined.length > 0 && (
            <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-2">
              Determined
            </p>
          )}
          <ul className="divide-y divide-rule-soft">
            {settled.map((r) => (
              <li key={r.id} className="py-2.5">
                <RiskRecordDetail risk={r} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * The read-only risk record for a call, wherever a call is being looked at.
 *
 * Renders nothing at all when the query comes back empty. That is deliberate:
 * RLS on risk_record filters rows the reader may not see, so an empty result
 * means "no risks" and "risks you cannot read" identically. Claiming either one
 * would be asserting something this component cannot know.
 */
export function CallRiskRecord({ callId }: { callId: string }): JSX.Element | null {
  const [risks, setRisks] = useState<RiskRecord[]>([]);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRisks(await risksForCall(callId));
    } catch {
      // Traceability metadata is not worth failing a page over, and there is
      // nothing useful to say about a risk we could not read.
      setRisks([]);
    }
  }, [callId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (risks.length === 0) return null;

  return (
    <section className="bg-card border border-rule rounded px-4 py-3.5 mb-4">
      <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-2">
        Risk &amp; escalation
      </p>
      <RiskRecordList risks={risks} />
    </section>
  );
}

/**
 * The compact list badge: category first, state second (0074).
 *
 *   Financial · Escalation      one record, escalated
 *   Financial · Risk            one record
 *   Financial · 2 risks         several, all the same category
 *   2 risks · Escalation        several that disagree — no single true category
 *
 * A category is shown only when every remaining record agrees on it. Where they
 * disagree the count stands alone: naming one of them would tell the reader
 * something the data does not support.
 */
export function riskContextLabel(ctx: RiskContext): string {
  const escalated = ctx.requires_escalation;
  if (ctx.count === 1) {
    const label = ctx.category ? categoryLabel(ctx.category) : "Risk";
    return ctx.category ? `${label} · ${escalated ? "Escalation" : "Risk"}` : label;
  }
  const count = `${ctx.count} risks`;
  const head = ctx.category ? `${categoryLabel(ctx.category)} · ${count}` : count;
  return escalated ? `${head} · Escalation` : head;
}

/**
 * Renders nothing when the call has no readable, undismissed risk — the same
 * reasoning as CallRiskRecord: RLS makes "none" and "not visible to you"
 * indistinguishable, so neither may be asserted.
 */
export function RiskContextBadge({
  context,
  className,
}: {
  context: RiskContext | undefined;
  className?: string;
}): JSX.Element | null {
  if (!context) return null;
  const escalated = context.requires_escalation;
  return (
    <span
      className={
        className ??
        `text-[11px] rounded-full px-2 py-0.5 border ${
          escalated ? "border-[#AC3A2A] text-[#AC3A2A]" : "border-rule text-ink-45"
        }`
      }
    >
      {riskContextLabel(context)}
    </span>
  );
}
