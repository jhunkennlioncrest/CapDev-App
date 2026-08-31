import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StageScorePicker } from "@/components/StageScorePicker";
import {
  CHECKLIST_STAGE_TO_TRAINER,
  saveStageScore,
  stageCeilings,
  stageScores,
  type StageCeiling,
  type TrainerStage,
} from "@/lib/calibration";
import { trainerScore, type TrainerScore } from "@/lib/calibration";
import { resolveSpeakersInText } from "@/lib/speakers";
import { useSpeakers } from "@/lib/useSpeakers";
import { CalibrationPanel } from "@/pages/CalibrationPanel";
import { RiskFlag } from "@/pages/RiskFlag";
import {
  getScores,
  openEvaluation,
  openRawSubmission,
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
import type { Segment } from "@/lib/transcript";
import {
  evidenceForEvaluation,
  getScoreIds,
  removeEvidence,
  type Evidence,
} from "@/lib/moments";
import { ClipDialog } from "@/components/ClipDialog";
import { formatDuration } from "@/lib/format";

interface Props {
  callId: string;
  callTitle: string;
  session: Session;
  transcriptId: string | null;
  segments: Segment[];
  /** Plays a span in the page's audio player, stopping at the end. */
  onPlayClip?: (startMs: number, endMs: number) => void;
  /** Solo mode: offered after a raw submit when the same person may calibrate. */
  onStartCalibration?: () => void;
  canCalibrate?: boolean;
  /** "raw" = Workspace A: observe only, no determination, no score shown. */
  mode?: "raw" | "calibrated";
  onClose: () => void;
}

export function EvaluationPanel({
  callId,
  callTitle,
  session,
  transcriptId,
  segments,
  onPlayClip,
  mode = "calibrated",
  onStartCalibration,
  canCalibrate = false,
  onClose,
}: Props): JSX.Element {
  const [rubric, setRubric] = useState<RubricVersion | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [values, setValues] = useState<Record<string, ScoreValue | null>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // During validation the carried-forward reviewer answers make every
  // criterion look answered. What counts is whether the trainer has
  // decided each one, which only the calibration panel knows.
  const [calibrated, setCalibrated] = useState<{ decided: number; total: number } | null>(
    null,
  );
  const remarkTimers = useRef<Record<string, number>>({});
  const [scoreIds, setScoreIds] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<Record<string, Evidence[]>>({});
  const [clipFor, setClipFor] = useState<Criterion | null>(null);
  const isRaw = mode === "raw";
  // A calibration derived from a raw submission is validation work; a direct
  // calibration with no reviewer behind it is an ordinary evaluation.
  const isValidation = !isRaw && Boolean(evaluation?.derived_from_id);
  const [rawValues, setRawValues] = useState<Record<string, ScoreValue | null>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { evaluation: ev, rubric: rb } = isRaw
          ? await openRawSubmission(callId, session.person.org_id, session.person.id)
          : await openEvaluation(callId, session.person.org_id, session.person.id);
        if (cancelled) return;
        const scores = await getScores(ev.id);
        if (cancelled) return;

        setEvaluation(ev);
        setRubric(rb);
        setValues(Object.fromEntries(scores.map((s) => [s.criterion_id, s.value])));
        setRemarks(Object.fromEntries(scores.map((s) => [s.criterion_id, s.remark])));
        setRawValues(Object.fromEntries(scores.map((s) => [s.criterion_id, s.raw_value])));

        const ids = await getScoreIds(ev.id);
        if (cancelled) return;
        setScoreIds(ids);
        setEvidence(await evidenceForEvaluation(Object.values(ids)));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId, session.person.org_id, session.person.id, isRaw]);

  const allCriteria = useMemo(
    () => (rubric?.sections ?? []).flatMap((s) => s.criteria),
    [rubric],
  );
  const answered = calibrated ? calibrated.decided : allCriteria.filter((c) => values[c.id]).length;
  const total = calibrated ? calibrated.total : allCriteria.length;
  const locked = evaluation?.status === "submitted";

  // The Trainer overall score, derived from the five stage scores.
  //
  // Deliberately NOT gated on `locked`: evaluation_stage_score is a separate
  // table, so a submitted calibration can still be scored. The checklist above
  // stays locked exactly as before.
  const [trainer, setTrainer] = useState<TrainerScore | null>(null);
  // Stage scoring for the DIRECT trainer path. CalibrationPanel covers calls
  // derived from a Raw QA observation; this covers the rest. Both are
  // kind='calibrated' and the rubric makes no distinction between them, so
  // both must be scoreable.
  const [ceilings, setCeilings] = useState<Record<string, StageCeiling>>({});
  const [stageValues, setStageValues] = useState<Record<string, number>>({});
  const refreshTrainer = useCallback(async (): Promise<void> => {
    if (!evaluation || mode !== "calibrated") return;
    try {
      const [t, ceil, scored] = await Promise.all([
        trainerScore(evaluation.id),
        stageCeilings(evaluation.id),
        stageScores(evaluation.id),
      ]);
      setTrainer(t);
      setCeilings(Object.fromEntries(ceil.map((c) => [c.stage, c])));
      setStageValues(
        Object.fromEntries(Object.entries(scored).map(([k, v]) => [k, v.score])),
      );
    } catch {
      // A missing score is not an error worth interrupting the panel for.
    }
  }, [evaluation, mode]);

  const setStage = useCallback(
    async (stage: TrainerStage, score: number): Promise<void> => {
      if (!evaluation) return;
      setStageValues((v) => ({ ...v, [stage]: score }));
      await saveStageScore({
        evaluationId: evaluation.id,
        stage,
        score,
        scoredBy: session.person.id,
      });
      void refreshTrainer();
    },
    [evaluation, session.person.id, refreshTrainer],
  );
  useEffect(() => { void refreshTrainer(); }, [refreshTrainer]);

  const reloadEvidence = useCallback(async (evId: string): Promise<void> => {
    const ids = await getScoreIds(evId);
    setScoreIds(ids);
    setEvidence(await evidenceForEvaluation(Object.values(ids)));
  }, []);

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
      await reloadEvidence(evaluation.id);
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
      {/* Sits under the player, not over it. Both offsets are measured at
          runtime so neither breaks when the nav or player wraps. */}
      <div
        className="sticky z-10 bg-ground border-b border-rule py-3 mb-5"
        style={{ top: "calc(var(--app-header-h, 0px) + var(--player-h, 0px))" }}
      >
        <div className="flex justify-between items-center gap-4 flex-wrap">
          <div>
            <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
              {isRaw ? "Raw observation" : "Calibration"} &middot; rubric v
              {rubric.version_label}
              {locked && " · submitted"}
            </p>
            <p className="font-display text-xl mt-0.5">{callTitle}</p>
          </div>
          <div className="flex items-center gap-5">
            {!isRaw && (
              <Stat
                value={evaluation.overall_score === null ? "—" : `${evaluation.overall_score}%`}
                label="score"
              />
            )}
            {/* The Trainer score is a different measurement from the checklist
                percentage beside it — how well the five stages were executed,
                against what proportion of items happened — so it is labelled
                out of 5.00 and never replaces the percentage.
                Hidden until all five stages are scored: v_trainer_score
                returns null before that, and a partial average would read as a
                finished judgement. */}
            {!isRaw && trainer?.trainer_overall_score != null && (
              <Stat
                value={`${trainer.trainer_overall_score.toFixed(2)} / 5.00`}
                label="trainer score"
              />
            )}
            <Stat value={`${answered}/${total}`} label={isRaw ? "observed" : "answered"} />
            {!isRaw && (
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
            )}
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

      {/* Validating a reviewer's work is a different task from scoring a call,
          so it gets a different surface: both answers side by side, variance
          named, and nothing counted as agreement until it is asserted. */}
      {isValidation ? (
        <CalibrationPanel
          evaluationId={evaluation.id}
          callId={callId}
          session={session}
          onPlayClip={onPlayClip}
          onCountsChanged={(decided, totalCount) =>
            setCalibrated({ decided, total: totalCount })
          }
          onStageScored={() => void refreshTrainer()}
          onNeedEvidence={(criterionId) => {
            // Nothing cited yet, so send them to the transcript first — the
            // same picker used everywhere else.
            const c = allCriteria.find((x) => x.id === criterionId);
            if (c) setClipFor(c);
          }}
        />
      ) : (
      rubric.sections.map((section) => {
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
                  <p className="text-[13px] text-ink-70 mb-2 max-w-2xl">{section.description}</p>
                )}
                {section.sort_order === 1 && segments.length > 0 && (
                  <p className="text-[13px] text-ink-45 mb-4 max-w-2xl">
                    After you answer an item, you can quote the lines from the
                    transcript that show it &mdash; that quote is what a coach reads later.
                  </p>
                )}
                {section.criteria.map((criterion, idx) => {
                  const prevStage = idx > 0 ? section.criteria[idx - 1]?.stage : undefined;
                  const showStage = criterion.stage && criterion.stage !== prevStage;
                  return (
                    <div key={criterion.id}>
                      {showStage && (
                        <div className="flex items-baseline justify-between gap-4 mt-5 mb-2">
                          <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
                            {criterion.stage}
                          </p>
                          {/* Trainer stage score. Calibrated evaluations only —
                              Raw QA reviewers record observations, not stage
                              judgements, and the database refuses the write
                              regardless. */}
                          {!isRaw && (
                            <StageScorePicker
                              stage={CHECKLIST_STAGE_TO_TRAINER[criterion.stage]}
                              ceiling={ceilings[CHECKLIST_STAGE_TO_TRAINER[criterion.stage] ?? ""]}
                              value={stageValues[CHECKLIST_STAGE_TO_TRAINER[criterion.stage] ?? ""]}
                              onPick={setStage}
                            />
                          )}
                        </div>
                      )}
                      <CriterionRow
                        criterion={criterion}
                        value={values[criterion.id] ?? null}
                        remark={remarks[criterion.id] ?? ""}
                        locked={locked}
                        rawValue={isRaw ? null : (rawValues[criterion.id] ?? null)}
                        evidence={evidence[scoreIds[criterion.id] ?? ""] ?? []}
                        canCite={!!scoreIds[criterion.id] && segments.length > 0}
                        hasTranscript={segments.length > 0}
                        onValue={(v) => void setValue(criterion, v)}
                        onRemark={(t) => setRemark(criterion, t)}
                        onCite={() => setClipFor(criterion)}
                        onPlayClip={onPlayClip}
                        onRemoveEvidence={(id) => {
                          void removeEvidence(id)
                            .then(() => reloadEvidence(evaluation.id))
                            .catch((err) =>
                              setError(err instanceof Error ? err.message : String(err)),
                            );
                        }}
                      />
                    </div>
                  );
                })}
              </>
            )}
          </section>
        );
      }))}

      {/* Section 3 — final determination. Trainer only. */}
      {!isRaw && (
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

          {/* The checkbox that used to sit here only set a boolean: it said
              nothing about what the risk was, and gave the trainer no way to
              agree or disagree with the reviewer. Replaced by the actual
              determination, which is the decision being made. */}
          <RiskFlag
            callId={callId}
            evaluationId={evaluation.id}
            session={session}
            locked={locked}
          />

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
      )}

      {/* A note and a risk are separate acts: an observation worth recording
          is not necessarily a concern, and a concern does not require prose.
          Either, both or neither. */}
      {isRaw && (
        <section className="mb-6">
          <h3 className="font-display text-xl border-b border-rule pb-2 mb-4">
            Your note
          </h3>
          <div className="bg-card border border-rule-soft rounded px-4 py-4 mb-6">
            <textarea
              disabled={locked}
              value={evaluation.summary_note}
              onChange={(e) =>
                setEvaluation({ ...evaluation, summary_note: e.target.value })
              }
              onBlur={(e) => void patch({ summary_note: e.target.value })}
              rows={3}
              placeholder="Anything the trainer should know. Optional."
              className="w-full border border-rule rounded px-2.5 py-2 text-[13px] bg-white disabled:opacity-60"
            />
          </div>
        </section>
      )}

      {isRaw && (
        <section className="mb-6">
          <h3 className="font-display text-xl border-b border-rule pb-2 mb-4">
            Risk &amp; escalation
          </h3>
          <RiskFlag
            callId={callId}
            evaluationId={evaluation.id}
            session={session}
            locked={locked}
          />
        </section>
      )}

      {locked && isRaw && canCalibrate && onStartCalibration && (
        <div className="border border-rule-soft rounded bg-card px-5 py-4 mb-5">
          <p className="font-display text-lg">Raw observations submitted</p>
          <p className="text-[13px] text-ink-70 mt-1">
            Everything you recorded &mdash; answers, notes and quotes &mdash; carries
            straight into calibration. Nothing needs re-entering.
          </p>
          <button
            onClick={onStartCalibration}
            className="mt-3 bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium hover:opacity-85"
          >
            Start calibration
          </button>
        </div>
      )}

      {clipFor && (
        <ClipDialog
          session={session}
          callId={callId}
          transcriptId={transcriptId}
          segments={segments}
          scoreId={scoreIds[clipFor.id] ?? null}
          criterion={clipFor}
          allCriteria={allCriteria}
          allowMoment={!isRaw}
          onPlayClip={onPlayClip}
          onClose={() => setClipFor(null)}
          onSaved={() => void reloadEvidence(evaluation.id)}
        />
      )}

      <div className="border-t border-rule pt-4 flex justify-between items-center gap-4 flex-wrap">
        <div className="text-[12px] text-ink-45">
          {locked ? (
            <>Submitted. This can no longer be changed.</>
          ) : savedAt ? (
            <>Saved automatically at {savedAt.toLocaleTimeString()}</>
          ) : (
            <>Changes save as you go</>
          )}
        </div>
        {!locked && (
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {/* The guard refuses for good reasons; those reasons belong beside
                the button that was pressed, not at the top of the page. */}
            {error && (
              <p className="text-[13px] text-[#AC3A2A] max-w-md text-right">{error}</p>
            )}
            <button
              onClick={() => void submit()}
              disabled={submitting || answered < total}
              className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium hover:opacity-85 disabled:opacity-40"
              title={
                answered < total
                  ? `${total - answered} criteria still to decide`
                  : undefined
              }
            >
              {submitting
                ? "Submitting…"
                : answered < total
                  ? `${total - answered} left to ${calibrated ? "decide" : "answer"}`
                  : isRaw
                    ? "Submit observations"
                    : "Submit evaluation"}
            </button>
          </div>
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
  rawValue,
  evidence,
  canCite,
  hasTranscript,
  onValue,
  onRemark,
  onCite,
  onPlayClip,
  onRemoveEvidence,
}: {
  criterion: Criterion;
  value: ScoreValue | null;
  remark: string;
  locked: boolean;
  rawValue: ScoreValue | null;
  evidence: Evidence[];
  canCite: boolean;
  hasTranscript: boolean;
  onValue: (v: ScoreValue) => void;
  onRemark: (t: string) => void;
  onCite: () => void;
  onPlayClip?: (startMs: number, endMs: number) => void;
  /** Solo mode: offered after a raw submit when the same person may calibrate. */
  onStartCalibration?: () => void;
  canCalibrate?: boolean;
  onRemoveEvidence: (id: string) => void;
}): JSX.Element {
  // Evidence carries its own call, so the mapping comes from there.
  const speakers = useSpeakers(evidence[0]?.call_id ?? null);
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

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {rawValue && (
            <span
              className={`font-mono text-[10.5px] ${
                value && value !== rawValue ? "text-[#AC3A2A]" : "text-ink-45"
              }`}
            >
              reviewer said {rawValue.toUpperCase()}
              {value && value !== rawValue && " · changed"}
            </span>
          )}
        <div className="flex gap-1.5">
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

      {evidence.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {evidence.map((ev) => (
            <li
              key={ev.id}
              className="border-l-2 border-ink pl-3 py-1 flex justify-between items-start gap-3"
            >
              <div className="min-w-0">
                <p className="font-mono text-[11px] text-ink-45">
                  {ev.start_ms !== null && ev.end_ms !== null ? (
                    <button
                      onClick={() => onPlayClip?.(ev.start_ms!, ev.end_ms!)}
                      className="underline underline-offset-2 hover:text-ink"
                      title="Play just this"
                    >
                      &#9654; {formatDuration(ev.start_ms)}&ndash;{formatDuration(ev.end_ms)}
                    </button>
                  ) : (
                    "cited"
                  )}
                  {ev.moment_id && " · also a teaching moment"}
                </p>
                <p className="text-[12.5px] text-ink-70 whitespace-pre-line">
                  {resolveSpeakersInText(ev.excerpt, speakers)}
                </p>
                {ev.note && <p className="text-[12.5px] mt-0.5">{ev.note}</p>}
              </div>
              {!locked && (
                <button
                  onClick={() => onRemoveEvidence(ev.id)}
                  className="text-[11.5px] text-ink-45 underline underline-offset-2 hover:text-ink shrink-0"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!locked && hasTranscript && (
        <div className="mt-3 pt-3 border-t border-rule-soft flex items-center gap-3 flex-wrap">
          {canCite ? (
            <button
              onClick={onCite}
              className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2 flex items-center gap-1.5"
            >
              <span aria-hidden>&#9633;</span>
              {evidence.length > 0 ? "Quote another line" : "Quote from transcript"}
            </button>
          ) : (
            <span className="text-[12px] text-ink-45">
              Answer this item to quote the transcript
            </span>
          )}

          {evidence.length === 0 && canCite && (
            <span className="text-[12px] text-ink-45">
              {value === "no"
                ? "A quote makes this coachable."
                : value === "yes"
                  ? "Worth quoting if this was well handled."
                  : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
