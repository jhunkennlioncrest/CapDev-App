import { useCallback, useEffect, useState } from "react";
import {
  RISK_CATEGORIES,
  determineRisk,
  raiseRisk,
  risksForCall,
  type RiskCategory,
  type RiskRecord,
} from "@/lib/risk";
import type { Session } from "@/lib/types";

/**
 * Raising and determining risks on one call.
 *
 * Used by both flows from the same component: a reviewer raises, a trainer
 * sees what was raised and determines it. The reviewer's category and note are
 * never edited by the determination — both positions survive, exactly as a
 * scoring disagreement does.
 */
export function RiskFlag({
  callId,
  evaluationId,
  session,
}: {
  callId: string;
  evaluationId: string;
  session: Session;
}): JSX.Element {
  const [risks, setRisks] = useState<RiskRecord[]>([]);
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<RiskCategory>("financial");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canDetermine = session.permissions.includes("calibration.perform");

  const load = useCallback(async (): Promise<void> => {
    try {
      setRisks(await risksForCall(callId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [callId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function raise(): Promise<void> {
    if (!note.trim()) {
      setError("Say what you noticed.");
      return;
    }
    try {
      await raiseRisk({ callId, evaluationId, category, note });
      setNote("");
      setAdding(false);
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="bg-card border border-rule rounded px-4 py-3.5 mb-4">
      <div className="flex justify-between items-baseline gap-3 flex-wrap">
        <div>
          <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
            Risk &amp; escalation
          </p>
          <p className="text-[12.5px] text-ink-70 mt-0.5">
            Anything needing attention beyond the score. Does not affect the
            representative&rsquo;s result.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2"
          >
            Flag a risk
          </button>
        )}
      </div>

      {error && <p className="text-[12.5px] text-[#AC3A2A] mt-2">{error}</p>}

      {adding && (
        <div className="mt-3 border-t border-rule-soft pt-3">
          <div className="grid sm:grid-cols-2 gap-2.5 mb-2.5">
            <label className="block">
              <span className="block text-[12px] font-semibold mb-1">Type</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as RiskCategory)}
                className="w-full border border-rule rounded px-2.5 py-1.5 bg-white text-[13.5px]"
              >
                {RISK_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <span className="block text-[11.5px] text-ink-45 mt-1">
                {RISK_CATEGORIES.find((c) => c.value === category)?.hint}
              </span>
            </label>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="What did you notice?"
            className="w-full border border-rule rounded px-2.5 py-2 text-[13px] mb-2"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void raise()}
              className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium"
            >
              Flag it
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className="border border-rule rounded px-3.5 py-1.5 text-[13px]"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11.5px] text-ink-45 mt-1.5">
            You can cite supporting passages once it is flagged.
          </p>
        </div>
      )}

      {risks.length > 0 && (
        <ul className="mt-3 border-t border-rule-soft divide-y divide-rule-soft">
          {risks.map((r) => (
            <RiskRow
              key={r.id}
              risk={r}
              canDetermine={canDetermine}
              onChanged={load}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RiskRow({
  risk,
  canDetermine,
  onChanged,
  onError,
}: {
  risk: RiskRecord;
  canDetermine: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}): JSX.Element {
  const [deciding, setDeciding] = useState(false);
  const [reason, setReason] = useState("");
  const [escalate, setEscalate] = useState(false);

  async function decide(determination: "valid" | "not_a_risk"): Promise<void> {
    try {
      await determineRisk({
        riskId: risk.id,
        determination,
        note: reason,
        requiresEscalation: determination === "valid" && escalate,
      });
      setDeciding(false);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  const label =
    RISK_CATEGORIES.find((c) => c.value === risk.category)?.label ?? risk.category;

  return (
    <li className="py-2.5">
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className="text-[12px] border border-rule rounded-full px-2 py-0.5">
          {label}
        </span>
        <span className="text-[12px] text-ink-45">
          raised by {risk.identified_by_role}
        </span>
        {risk.requires_escalation && (
          <span className="text-[11px] text-[#AC3A2A] border border-[#AC3A2A] rounded-full px-2 py-0.5">
            Escalate
          </span>
        )}
        <span className="text-[11px] text-ink-45 ml-auto">{risk.status}</span>
      </div>

      <p className="text-[13px] mt-1">{risk.note}</p>

      {/* The determination sits beside the observation, never replacing it. */}
      {risk.determination ? (
        <p className="text-[12.5px] text-ink-70 mt-1">
          <span className="font-semibold">
            {risk.determination === "valid" ? "Confirmed" : "Not a risk"}
          </span>
          {risk.determination_note && ` — ${risk.determination_note}`}
        </p>
      ) : canDetermine ? (
        deciding ? (
          <div className="mt-2">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why — the reviewer will read this"
              className="w-full border border-rule rounded px-2.5 py-2 text-[13px] mb-2"
            />
            <label className="flex items-center gap-2 text-[12.5px] mb-2">
              <input
                type="checkbox"
                checked={escalate}
                onChange={(e) => setEscalate(e.target.checked)}
              />
              Needs action outside QA
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => void decide("valid")}
                className="bg-ink text-ground border border-ink rounded px-3 py-1.5 text-[12.5px]"
              >
                Confirm risk
              </button>
              <button
                onClick={() => void decide("not_a_risk")}
                className="border border-rule rounded px-3 py-1.5 text-[12.5px]"
              >
                Not a risk
              </button>
              <button
                onClick={() => setDeciding(false)}
                className="text-[12.5px] text-ink-45 underline underline-offset-2 px-1"
              >
                Later
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setDeciding(true)}
            className="text-[12.5px] text-accent underline underline-offset-2 mt-1"
          >
            Determine this
          </button>
        )
      ) : (
        <p className="text-[12px] text-ink-45 mt-1">
          Awaiting a trainer&rsquo;s determination.
        </p>
      )}
    </li>
  );
}
