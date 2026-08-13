import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getScores,
  openEvaluation,
  refreshEvaluation,
  saveScore,
  submitEvaluation,
  updateEvaluation,
  type Criterion,
  type Evaluation,
  type RubricVersion,
  type ScoreValue,
} from "@/lib/evaluation";
import type { Session } from "@/lib/types";

interface Props {
  callId: string;
  callTitle: string;
  session: Session;
  onClose: () => void;
}

export function EvaluationPanel({ callId, callTitle, session, onClose }: Props): JSX.Element {
  const [rubric, setRubric] = useState<RubricVersion | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [values, setValues] = useState<Record<string, ScoreValue | null>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const remarkTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { evaluation: ev, rubric: rb } = await openEvaluation(
          callId,
          session.person.org_id,
          session.person.id,
        );
        if (cancelled) return;
        const scores = await getScores(ev.id);
        if (cancelled) return;

        setEvaluation(ev);
        setRubric(rb);
        setValues(Object.fromEntries(scores.map((s) => [s.criterion_id, s.value])));
        setRemarks(Object.fromEntries(scores.map((s) => [s.criterion_id, s.remark])));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId, session.person.org_id, session.person.id]);

  const allCriteria = useMemo(
    () => (rubric?.sections ?? []).flatMap((s) => s.criteria),
    [rubric],
  );
  const answered = allCriteria.filter((c) => values[c.id]).length;
  const total = allCriteria.length;
  const locked = evaluation?.status === "submitted";

  const sync = useCallback(async (evId: string): Promise<void> => {
    const fresh = await refreshEvaluation(evId);
    if (fresh) setEvaluation(fresh);
    setSavedAt(new Date());
  }, []);

  async function setValue(criterion: Criterion, value: ScoreValue): Promise<void> {
    if (!evaluation || locked) return;
    // Tapping the chosen value again clears it — an unanswered item is a real
    // state, and being unable to undo a misclick is worse than an extra tap.
    const next = values[criterion.id] === value ? null : value;
    setValues((v) => ({ ...v, [criterion.id]: next }));
    try {
      await saveScore(evaluation.id, criterion.id, next, remarks[criterion.id] ?? "");
      await sync(evaluation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function setRemark(criterion: Criterion, text: string): void {
    if (!evaluation || locked) return;
    setRemarks((r) => ({ ...r, [criterion.id]: text }));
    window.clearTimeout(remarkTimers.current[criterion.id]);
    remarkTimers.current[criterion.id] = window.setTimeout(() => {
      void saveScore(evaluation.id, criterion.id, values[criterion.id] ?? null, text)
        .then(() => setSavedAt(new Date()))
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 800);
  }

  async function patch(p: Parameters<typeof updateEvaluation>[1]): Promise<void> {
    if (!evaluation || locked) return;
    setEvaluation({ ...evaluation, ...p } as Evaluation);
    await updateEvaluation(evaluation.id, p);
    await sync(evaluation.id);
  }

  async function submit(): Promise<void> {
    if (!evaluation) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitEvaluation(evaluation.id);
      await sync(evaluation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-ink-45 text-sm py-8">Opening evaluation&hellip;</p>;

  if (error && !rubric) {
    return (
      <div className="border border-rule-soft rounded bg-card px-6 py-8 text-center">
        <p className="text-[13px] text-[#AC3A2A]">{error}</p>
        <button onClick={onClose} className="mt-4 border border-rule rounded px-3.5 py-1.5 text-[13px]">
          Close
        </button>
      </div>
    );
  }
  if (!rubric || !evaluation) return <p className="text-ink-45 text-sm py-8">Nothing to show.</p>;

  return (
    <div>
      {/* Running state. Sticky because it is the thing an evaluator glances at. */}
      <div className="sticky top-0 z-20 bg-ground border-b border-rule py-3 mb-5">
        <div className="flex justify-between items-center gap-4 flex-wrap">
          <div>
            <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
              Evaluating &middot; rubric v{rubric.version_label}
              {locked && " · submitted"}
            </p>
            <p className="font-display text-xl mt-0.5">{callTitle}</p>
          </div>
          <div className="flex items-center gap-5">
            <Stat
              value={evaluation.overall_score === null ? "—" : `${evaluation.overall_score}%`}
              label="score"
            />
            <Stat value={`${answered}/${total}`} label="answered" />
            <Stat
              value={
                evaluation.reward_tier === "premium"
                  ? "Premium"
                  : evaluation.reward_tier === "kudos"
                    ? "Kudos"
                    : "—"
              }
              label="reward"
            />
            <button onClick={onClose} className="border border-rule rounded px-3 py-1.5 text-[13px] hover:bg-ground-2">
              Close
            </button>
          </div>
        </div>
        <div className="h-1 bg-ground-2 rounded mt-3 overflow-hidden">
          <div
            className="h-full bg-ink transition-all"
            style={{ width: total ? `${(answered / total) * 100}%` : "0%" }}
          />
        </div>
      </div>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-4">{error}</p>}

      {rubric.sections.map((section) => {
        const isCollapsed = collapsed[section.id];
        const done = section.criteria.filter((c) => values[c.id]).length;
        return (
          <section key={section.id} className="mb-6">
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [section.id]: !isCollapsed }))}
              className="w-full flex justify-between items-baseline gap-3 border-b border-rule pb-2 mb-3 text-left"
            >
              <h3 className="font-display text-xl">
                {section.title}
                <span className="font-sans text-[12px] text-ink-45 ml-2.5">
                  {done}/{section.criteria.length}
                </span>
              </h3>
              <span className="text-[12px] text-ink-45">{isCollapsed ? "Show" : "Hide"}</span>
            </button>

            {!isCollapsed && (
              <>
                {section.description && (
                  <p className="text-[13px] text-ink-70 mb-4 max-w-2xl">{section.description}</p>
                )}
                {section.criteria.map((criterion, idx) => {
                  const prevStage = idx > 0 ? section.criteria[idx - 1]?.stage : undefined;
                  const showStage = criterion.stage && criterion.stage !== prevStage;
                  return (
                    <div key={criterion.id}>
                      {showStage && (
                        <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mt-5 mb-2">
                          {criterion.stage}
                        </p>
                      )}
                      <CriterionRow
                        criterion={criterion}
                        value={values[criterion.id] ?? null}
                        remark={remarks[criterion.id] ?? ""}
                        locked={locked}
                        onValue={(v) => void setValue(criterion, v)}
                        onRemark={(t) => setRemark(criterion, t)}
                      />
                    </div>
                  );
                })}
              </>
            )}
          </section>
        );
      })}

      {/* Section 3 — final determination */}
      <section className="mb-6">
        <h3 className="font-display text-xl border-b border-rule pb-2 mb-4">Final determination</h3>

        <div className="bg-card border border-rule-soft rounded px-4 py-4 space-y-4">
          <label className="block">
            <span className="block text-[12px] font-semibold mb-1.5">
              How did the author end the call?
            </span>
            <div className="flex gap-2 flex-wrap">
              {["satisfied", "relieved", "grateful", "other"].map((state) => (
                <button
                  key={state}
                  disabled={locked}
                  onClick={() => void patch({ author_end_state: state })}
                  className={`border rounded px-3 py-1.5 text-[13px] capitalize disabled:opacity-50 ${
                    evaluation.author_end_state === state
                      ? "bg-ink text-ground border-ink"
                      : "border-rule hover:bg-ground-2"
                  }`}
                >
                  {state}
                </button>
              ))}
            </div>
          </label>

          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              disabled={locked}
              checked={evaluation.is_high_risk}
              onChange={(e) => void patch({ is_high_risk: e.target.checked })}
              className="mt-1"
            />
            <span className="text-[13px]">
              <span className="font-semibold">High-risk or escalation call</span>
              <span className="text-ink-45"> — refund threat, grievance, or similar</span>
            </span>
          </label>

          <label className="block">
            <span className="block text-[12px] font-semibold mb-1.5">Summary</span>
            <textarea
              disabled={locked}
              value={evaluation.summary_note}
              onChange={(e) => setEvaluation({ ...evaluation, summary_note: e.target.value })}
              onBlur={(e) => void patch({ summary_note: e.target.value })}
              rows={3}
              placeholder="What decided this call, in a sentence or two."
              className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm disabled:opacity-60"
            />
          </label>
        </div>
      </section>

      <div className="border-t border-rule pt-4 flex justify-between items-center gap-4 flex-wrap">
        <div className="text-[12px] text-ink-45">
          {locked ? (
            <>Submitted. This evaluation can no longer be changed.</>
          ) : savedAt ? (
            <>Saved automatically at {savedAt.toLocaleTimeString()}</>
          ) : (
            <>Changes save as you go</>
          )}
        </div>
        {!locked && (
          <button
            onClick={() => void submit()}
            disabled={submitting || answered < total}
            className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium hover:opacity-85 disabled:opacity-40"
            title={answered < total ? `${total - answered} items still unanswered` : undefined}
          >
            {submitting
              ? "Submitting…"
              : answered < total
                ? `${total - answered} left to answer`
                : "Submit evaluation"}
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div className="text-right">
      <span className="font-display text-2xl block leading-none">{value}</span>
      <span className="text-[11px] text-ink-45">{label}</span>
    </div>
  );
}

function CriterionRow({
  criterion,
  value,
  remark,
  locked,
  onValue,
  onRemark,
}: {
  criterion: Criterion;
  value: ScoreValue | null;
  remark: string;
  locked: boolean;
  onValue: (v: ScoreValue) => void;
  onRemark: (t: string) => void;
}): JSX.Element {
  const [showGuidance, setShowGuidance] = useState(false);
  const needsRemark = value === "no" && !remark.trim();

  return (
    <div
      className={`bg-card border rounded px-4 py-3.5 mb-2 ${
        needsRemark ? "border-[#96690A]" : "border-rule-soft"
      }`}
    >
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[14px]">
            <span className="font-mono text-[11px] text-ink-45 mr-2">{criterion.code}</span>
            {criterion.label && criterion.code.startsWith("NN") && (
              <span className="font-semibold">{criterion.label}. </span>
            )}
            {criterion.statement}
          </p>

          {(criterion.guidance.length > 0 || criterion.na_condition) && (
            <button
              onClick={() => setShowGuidance((s) => !s)}
              className="text-[12px] text-ink-45 underline underline-offset-2 hover:text-ink mt-1.5"
            >
              {showGuidance ? "Hide guidance" : "What to listen for"}
            </button>
          )}

          {showGuidance && (
            <div className="mt-2 text-[12.5px] text-ink-70 border-l-2 border-rule pl-3">
              {criterion.guidance.map((g) => (
                <p key={g} className="mb-1">
                  {g}
                </p>
              ))}
              {criterion.na_condition && (
                <p className="mt-2">
                  <span className="font-semibold">N/A if:</span> {criterion.na_condition}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-1.5 shrink-0">
          {(["yes", "no", "na"] as ScoreValue[]).map((v) => (
            <button
              key={v}
              disabled={locked}
              onClick={() => onValue(v)}
              className={`border rounded px-3 py-1.5 text-[13px] uppercase font-mono disabled:opacity-50 ${
                value === v
                  ? v === "yes"
                    ? "bg-[#1F7A4D] text-white border-[#1F7A4D]"
                    : v === "no"
                      ? "bg-[#AC3A2A] text-white border-[#AC3A2A]"
                      : "bg-ink text-ground border-ink"
                  : "border-rule hover:bg-ground-2"
              }`}
            >
              {v === "na" ? "N/A" : v}
            </button>
          ))}
        </div>
      </div>

      {(value === "no" || remark) && (
        <div className="mt-3">
          <input
            disabled={locked}
            value={remark}
            onChange={(e) => onRemark(e.target.value)}
            placeholder={
              value === "no"
                ? "What happened? This is what a coach will read."
                : "Remarks (optional)"
            }
            className="w-full border border-rule rounded px-2.5 py-1.5 bg-white text-[13px] disabled:opacity-60"
          />
          {needsRemark && (
            <p className="text-[11.5px] text-[#96690A] mt-1">
              A &ldquo;no&rdquo; needs a note — otherwise nobody can coach from it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
