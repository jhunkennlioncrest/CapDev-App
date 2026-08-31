import { useCallback, useEffect, useMemo, useState } from "react";
import { StageScorePicker } from "@/components/StageScorePicker";
import {
  CHECKLIST_STAGE_TO_TRAINER,
  saveStageScore,
  stageCeilings,
  stageScores,
  type StageCeiling,
  type TrainerStage,
} from "@/lib/calibration";
import { resolveSpeakersInText, type SpeakerMap } from "@/lib/speakers";
import { TranscriptSelector, excerptForRange } from "@/components/TranscriptSelector";
import { getTranscript } from "@/lib/calls";
import type { SelectionRun } from "@/lib/moments";
import type { Segment } from "@/lib/transcript";
import { useSpeakers } from "@/lib/useSpeakers";
import {
  adoptReviewerEvidence,
  MOMENT_KINDS,
  momentFromEvidence,
  agreeWithRemaining,
  citeEvidence,
  decide,
  parseClock,
  removeEvidence,
  getCalibrationRows,
  getSummary,
  VARIANCE_LABELS,
  type Answer,
  type CalibrationRow,
  type CalibrationSummary,
  type EvidenceItem,
} from "@/lib/calibration";
import { formatDate } from "@/lib/format";
import type { Session } from "@/lib/types";

/** mm:ss, the way a timestamp is spoken about. */
function formatClock(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const ANSWERS: { value: Answer; label: string }[] = [
  { value: "yes", label: "YES" },
  { value: "no", label: "NO" },
  { value: "na", label: "N/A" },
];

/**
 * The calibration workspace.
 *
 * Each criterion shows two perspectives: what the reviewer observed, read-only,
 * and what the trainer decides. The trainer is never editing the reviewer's
 * answer — that record is immutable — they are making their own judgement with
 * the reviewer's work in view.
 */
export function CalibrationPanel({
  evaluationId,
  callId,
  session,
  onPlayClip,
  onCountsChanged,
  onNeedEvidence,
  onStageScored,
}: {
  evaluationId: string;
  callId: string;
  session: Session;
  /** Bounded playback: starts at the quote and stops at its end. */
  onPlayClip?: (startMs: number, endMs: number) => void;
  onCountsChanged?: (decided: number, total: number) => void;
  /** Opens the transcript picker when there is nothing cited yet. */
  onNeedEvidence?: (criterionId: string) => void;
  /** Fired after a stage score is saved so the overall can refresh. */
  onStageScored?: () => void;
}): JSX.Element {
  // One mapping for the whole panel: reviewer evidence and trainer evidence
  // resolve through exactly the same source as the main transcript.
  const speakers = useSpeakers(callId);
  // Loaded once here rather than per criterion: the trainer may cite on any
  // of them, and refetching the transcript sixteen times would be wasteful.
  const [segments, setSegments] = useState<Segment[]>([]);
  // Which criteria the trainer has closed off. Deliberately UI-only: the
  // database already records the decision (calibrated_at) and whether it is
  // supportable (blocker). "Done" is the trainer saying they have finished
  // looking, which is not a fact about the evaluation and does not belong in
  // it. Reopening loses nothing.
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void getTranscript(callId).then((t) => setSegments(t?.segments ?? []));
  }, [callId]);
  const [rows, setRows] = useState<CalibrationRow[]>([]);
  // Trainer stage scoring. Loaded alongside the checklist so the ceiling and
  // any existing score are known before a header renders.
  const [ceilings, setCeilings] = useState<Record<string, StageCeiling>>({});
  const [stageValues, setStageValues] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState<CalibrationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setStage = useCallback(
    async (stage: TrainerStage, score: number): Promise<void> => {
      // Optimistic: the selector should respond immediately, and a failure is
      // surfaced rather than silently reverting to a stale value.
      setStageValues((v) => ({ ...v, [stage]: score }));
      try {
        await saveStageScore({
          evaluationId,
          stage,
          score,
          scoredBy: session.person.id,
        });
        onStageScored?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [evaluationId, session.person.id, onStageScored],
  );

  const load = useCallback(async (): Promise<void> => {
    try {
      const [r, s, ceil, scored] = await Promise.all([
        getCalibrationRows(evaluationId),
        getSummary(evaluationId),
        stageCeilings(evaluationId),
        stageScores(evaluationId),
      ]);
      setRows(r);
      setSummary(s);
      setCeilings(Object.fromEntries(ceil.map((c) => [c.stage, c])));
      setStageValues(
        Object.fromEntries(Object.entries(scored).map(([k, v]) => [k, v.score])),
      );
      onCountsChanged?.(r.filter((x) => x.calibrated_at).length, r.length);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [evaluationId, onCountsChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  const undecided = useMemo(() => rows.filter((r) => !r.calibrated_at).length, [rows]);
  const changed = useMemo(
    () => rows.filter((r) => r.variance && r.variance !== "agreed"),
    [rows],
  );
  // Only disagreements can be outstanding: agreeing needs no new evidence,
  // because the reviewer already supplied it.
  const outstanding = useMemo(
    () =>
      rows.filter(
        (r) => r.blocker === "needs_evidence" || r.blocker === "needs_justification",
      ),
    [rows],
  );

  async function onDecide(row: CalibrationRow, value: Answer, note?: string): Promise<void> {
    // Optimistic: the trainer should never wait to see their own decision.
    setRows((rs) =>
      rs.map((r) =>
        r.criterion_id === row.criterion_id
          ? {
              ...r,
              value,
              remark: note ?? r.remark,
              calibrated_at: new Date().toISOString(),
              variance:
                r.raw_value === null
                  ? null
                  : value === r.raw_value
                    ? "agreed"
                    : r.raw_value === "yes" && value === "no"
                      ? "missed_failure"
                      : r.raw_value === "no" && value === "yes"
                        ? "false_failure"
                        : "scope_change",
            }
          : r,
      ),
    );
    try {
      await decide({ evaluationId, criterionId: row.criterion_id, value, note });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load();
    }
  }

  async function onAgreeRest(): Promise<void> {
    setBusy(true);
    try {
      await agreeWithRemaining(evaluationId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-ink-45 text-sm">Loading&hellip;</p>;

  const sections = [...new Set(rows.map((r) => r.section_code))];

  return (
    <div>
      <div className="border border-rule rounded bg-ground px-4 py-3 mb-5">
        <p className="text-[13px] text-ink-70">
          You are checking whether the reviewer read the rubric correctly &mdash;
          not scoring the call again. Their answers are shown beside yours and
          cannot be changed.
        </p>
      </div>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      {undecided > 0 && (
        <div className="flex justify-between items-center gap-4 flex-wrap border-b border-rule pb-3 mb-4">
          <p className="text-[13px]">
            <span className="font-semibold">{undecided}</span> of {rows.length} still to
            check
            {changed.length > 0 && (
              <span className="text-ink-45"> &middot; {changed.length} changed so far</span>
            )}
          </p>
          <button
            onClick={() => void onAgreeRest()}
            disabled={busy}
            className="border border-ink rounded px-3.5 py-1.5 text-[13px] hover:bg-ground-2 disabled:opacity-40"
          >
            {busy ? "Agreeing…" : `Agree with the remaining ${undecided}`}
          </button>
        </div>
      )}

      {undecided === 0 && summary && <SummaryCard summary={summary} />}

      {outstanding.length > 0 && (
        <div className="border border-[#96690A] rounded bg-card px-4 py-3 mb-5">
          <p className="text-[13px]">
            <span className="font-semibold">
              {outstanding.length} changed criteri{outstanding.length === 1 ? "on" : "a"}
            </span>{" "}
            still need what supports the decision:{" "}
            <span className="font-mono text-[12px]">
              {outstanding.map((r) => r.code).join(", ")}
            </span>
          </p>
        </div>
      )}

      {sections.map((code) => {
        const inSection = rows.filter((r) => r.section_code === code);
        const first = inSection[0];
        return (
          <section key={code} className="mb-6">
            <h3 className="font-display text-xl border-b border-rule pb-2 mb-3">
              {first?.section_title}
            </h3>
            {inSection.map((row, i) => {
              const prevStage = i > 0 ? inSection[i - 1]?.stage : undefined;
              return (
                <div key={row.criterion_id}>
                  {row.stage && row.stage !== prevStage && (
                    <div className="flex items-baseline justify-between gap-4 mt-4 mb-2">
                      <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
                        {row.stage}
                      </p>
                      {/* The Trainer stage score sits with its own checklist
                          items directly beneath, which is how the rubric asks
                          it to be judged. */}
                      <StageScorePicker
                        stage={CHECKLIST_STAGE_TO_TRAINER[row.stage]}
                        ceiling={ceilings[CHECKLIST_STAGE_TO_TRAINER[row.stage] ?? ""]}
                        value={stageValues[CHECKLIST_STAGE_TO_TRAINER[row.stage] ?? ""]}
                        onPick={setStage}
                      />
                    </div>
                  )}
                  <CriterionRow
                    row={row}
                    callId={callId}
                    session={session}
                    onDecide={onDecide}
                    onPlayClip={onPlayClip}
                    onRefresh={load}
                    speakers={speakers}
                    segments={segments}
                    isDone={doneIds.has(row.criterion_id)}
                    onDone={(id, done) =>
                      setDoneIds((prev) => {
                        const next = new Set(prev);
                        if (done) next.add(id);
                        else next.delete(id);
                        return next;
                      })
                    }
                    onNeedEvidence={(r) => onNeedEvidence?.(r.criterion_id)}
                  />
                </div>
              );
            })}
          </section>
        );
      })}
      {(undecided > 0 || outstanding.length > 0) && (
        <div className="border border-[#96690A] rounded bg-card px-4 py-3.5 mt-6">
          <p className="text-[13px] font-semibold mb-1">
            Not ready to submit yet
          </p>
          {undecided > 0 && (
            <p className="text-[13px] text-ink-70">
              {undecided} criteri{undecided === 1 ? "on has" : "a have"} not been
              decided. The reviewer&rsquo;s answers are shown but count as yours
              only once you agree or change them.
            </p>
          )}
          {outstanding.length > 0 && (
            <p className="text-[13px] text-ink-70 mt-1">
              {outstanding.length} changed criteri
              {outstanding.length === 1 ? "on needs" : "a need"} evidence and a
              justification:{" "}
              <span className="font-mono text-[12px]">
                {outstanding.map((r) => r.code).join(", ")}
              </span>
            </p>
          )}
          {undecided > 0 && (
            <button
              onClick={() => void onAgreeRest()}
              disabled={busy}
              className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium mt-2.5 disabled:opacity-40"
            >
              {busy ? "Agreeing…" : `Agree with the remaining ${undecided}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ summary }: { summary: CalibrationSummary }): JSX.Element {
  return (
    <div className="bg-card border border-ink rounded px-5 py-4 mb-6">
      <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-3">
        Calibration summary
      </p>
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <Figure value={`${summary.agreement_rate ?? "—"}%`} caption="agreement" large />
        <Figure value={String(summary.criteria_compared)} caption="criteria" />
        <Figure value={String(summary.agreed)} caption="agreed" />
        <Figure value={String(summary.changed)} caption="changed" />
        {summary.missed_failures > 0 && (
          <Figure
            value={String(summary.missed_failures)}
            caption="missed failures"
            colour="#AC3A2A"
          />
        )}
        {summary.false_failures > 0 && (
          <Figure
            value={String(summary.false_failures)}
            caption="false failures"
            colour="#96690A"
          />
        )}
      </div>
      <p className="text-[12px] text-ink-45 mt-3">
        This describes the calibration, not the call
        {summary.reviewer_name && ` · reviewer ${summary.reviewer_name}`}
        {summary.version_label && ` · rubric v${summary.version_label}`}
      </p>
    </div>
  );
}

function Figure({
  value,
  caption,
  large = false,
  colour,
}: {
  value: string;
  caption: string;
  large?: boolean;
  colour?: string;
}): JSX.Element {
  return (
    <div>
      <span
        className={`font-display block leading-none mb-1 ${large ? "text-3xl" : "text-2xl"}`}
        style={colour ? { color: colour } : undefined}
      >
        {value}
      </span>
      <span className="text-[11.5px] text-ink-45">{caption}</span>
    </div>
  );
}

function CriterionRow({
  row,
  callId,
  session,
  onDecide,
  onPlayClip,
  onRefresh,
  speakers,
  segments,
  isDone,
  onDone,
  onNeedEvidence,
}: {
  row: CalibrationRow;
  callId: string;
  session: Session;
  segments: Segment[];
  isDone: boolean;
  onDone: (criterionId: string, done: boolean) => void;
  onDecide: (row: CalibrationRow, value: Answer, note?: string) => Promise<void>;
  onPlayClip?: (startMs: number, endMs: number) => void;
  onRefresh: () => Promise<void>;
  speakers: SpeakerMap;
  onNeedEvidence: (row: CalibrationRow) => void;
}): JSX.Element {
  const [note, setNote] = useState(row.remark);
  const [showNote, setShowNote] = useState(false);
  const [showGuidance, setShowGuidance] = useState(false);

  useEffect(() => setNote(row.remark), [row.remark]);

  const decided = Boolean(row.calibrated_at);
  const variance = row.variance && row.variance !== "agreed" ? row.variance : null;
  const spec = variance ? VARIANCE_LABELS[variance] : null;

  // The same blocker the submit guard uses, so Done can never mark something
  // finished that the evaluation would then refuse to submit.
  const canFinish = decided && !row.blocker;

  // Finished: collapse to a single line. Nothing is saved or discarded by
  // this — every decision, passage and justification is untouched underneath.
  if (isDone) {
    return (
      <div
        className="bg-card border border-rule-soft rounded mb-2.5 px-3.5 py-2.5 flex items-center gap-3 flex-wrap"
        style={variance && spec ? { borderLeftColor: spec.colour, borderLeftWidth: 2 } : undefined}
      >
        <span className="text-[#1F7A4D] text-[13px] shrink-0" aria-hidden="true">
          &#10003;
        </span>
        <span className="font-mono text-[11px] text-ink-45 shrink-0">{row.code}</span>
        <span className="text-[13.5px] flex-1 min-w-0 truncate">{row.label}</span>
        {row.value && (
          <span className="font-mono text-[11.5px] uppercase shrink-0">{row.value}</span>
        )}
        {variance && spec && (
          <span className="text-[11px] shrink-0" style={{ color: spec.colour }}>
            {spec.label}
          </span>
        )}
        <button
          onClick={() => onDone(row.criterion_id, false)}
          className="text-[12px] text-ink-45 underline underline-offset-2 hover:text-ink shrink-0"
        >
          Reopen
        </button>
      </div>
    );
  }

  return (
    <div
      className={`bg-card border rounded mb-2.5 ${
        variance ? "border-l-2" : decided ? "border-rule-soft" : "border-rule"
      }`}
      style={variance && spec ? { borderLeftColor: spec.colour } : undefined}
    >
      <div className="px-4 pt-3.5 pb-2">
        <p className="text-[14px]">
          <span className="font-mono text-[11px] text-ink-45 mr-2">{row.code}</span>
          {row.label && row.section_kind === "non_negotiable" && (
            <span className="font-semibold">{row.label}. </span>
          )}
          {row.statement}
        </p>
        {(row.guidance.length > 0 || row.na_condition) && (
          <button
            onClick={() => setShowGuidance((g) => !g)}
            className="text-[12px] text-ink-45 underline underline-offset-2 mt-1"
          >
            What the rubric asks for
          </button>
        )}
        {showGuidance && (
          <div className="mt-2 text-[12.5px] text-ink-70 border-l-2 border-rule pl-3">
            {row.guidance.map((g) => (
              <p key={g} className="mb-1">
                {g}
              </p>
            ))}
            {row.na_condition && (
              <p className="mt-1.5">
                <span className="font-semibold">N/A if:</span> {row.na_condition}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 border-t border-rule-soft">
        {/* The reviewer's complete observation: answer, evidence, reasoning.
            Tinted and bordered so it reads as a record being examined rather
            than a field being edited. */}
        <div className="px-4 py-3 sm:border-r border-rule-soft bg-ground/50">
          <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-2">
            Reviewer observation &middot; read only
          </p>

          <div className="flex items-baseline gap-2.5 flex-wrap">
            <span className="font-mono text-[15px] font-semibold">
              {row.raw_value ? row.raw_value.toUpperCase() : "—"}
            </span>
            {row.raw_updated_at && (
              <span className="text-[11.5px] text-ink-45">
                {formatDate(row.raw_updated_at)}
              </span>
            )}
          </div>

          {row.raw_evidence.length > 0 ? (
            <div className="mt-2.5">
              <p className="text-[11px] text-ink-45 mb-1.5">
                {row.raw_evidence.length === 1
                  ? "Evidence"
                  : `Evidence · ${row.raw_evidence.length} quotes`}
              </p>
              <ul className="space-y-1.5">
                {row.raw_evidence.map((ev) => (
                  <li key={ev.id} className="border-l-2 border-rule pl-2.5">
                    {ev.start_ms !== null && onPlayClip ? (
                      <button
                        onClick={() => onPlayClip(ev.start_ms ?? 0, ev.end_ms ?? (ev.start_ms ?? 0) + 15000)}
                        title="Play just this passage"
                        className="font-mono text-[11.5px] text-accent hover:underline underline-offset-2"
                      >
                        &#9654; {formatClock(ev.start_ms)}
                        {ev.end_ms !== null && `–${formatClock(ev.end_ms)}`}
                      </button>
                    ) : (
                      ev.start_ms !== null && (
                        <span className="font-mono text-[11.5px] text-ink-45">
                          {formatClock(ev.start_ms)}
                          {ev.end_ms !== null && `–${formatClock(ev.end_ms)}`}
                        </span>
                      )
                    )}
                    {ev.excerpt && (
                      <p className="text-[12.5px] text-ink-70 leading-relaxed mt-0.5 whitespace-pre-line">
                        &ldquo;{resolveSpeakersInText(ev.excerpt, speakers)}&rdquo;
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            /* Evidence quality is part of what calibration validates, so its
               absence is stated rather than left as blank space. */
            <p className="text-[12px] text-[#96690A] mt-2.5">
              &#9888; No supporting evidence attached.
            </p>
          )}

          {row.raw_remark ? (
            <div className="mt-2.5">
              <p className="text-[11px] text-ink-45 mb-0.5">Reviewer notes</p>
              <p className="text-[12.5px] text-ink-70 leading-relaxed">{row.raw_remark}</p>
            </div>
          ) : (
            <p className="text-[12px] text-ink-45 mt-2.5">No reviewer note.</p>
          )}
        </div>

        {/* The trainer's decision */}
        <div className="px-4 py-3">
          <div className="flex justify-between items-baseline gap-2 mb-1.5">
            <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
              Your decision
            </p>
            {decided && !variance && (
              <span className="text-[11px] text-[#1F7A4D]">agreed</span>
            )}
            {spec && (
              <span className="text-[11px]" style={{ color: spec.colour }}>
                {spec.label}
              </span>
            )}
          </div>

          <div className="flex gap-1.5">
            {ANSWERS.map((a) => {
              const chosen = decided && row.value === a.value;
              const matchesReviewer = row.raw_value === a.value;
              return (
                <button
                  key={a.value}
                  onClick={() => void onDecide(row, a.value, note || undefined)}
                  className={`border rounded px-3 py-1.5 text-[13px] font-mono transition-colors ${
                    chosen
                      ? "bg-ink text-ground border-ink"
                      : matchesReviewer
                        ? "border-rule text-ink hover:bg-ground-2"
                        : "border-rule-soft text-ink-45 hover:bg-ground-2 hover:text-ink"
                  }`}
                >
                  {a.label}
                </button>
              );
            })}
          </div>

          {spec && <p className="text-[12px] text-ink-45 mt-2">{spec.meaning}</p>}

          {/* Teachable is independent of agreement: an excellent call teaches
              as much as a disputed one. So this sits outside the justification
              section, which only appears on disagreement. */}
          <TeachThis
            row={row}
            onPlayClip={onPlayClip}
            onRefresh={onRefresh}
            onNeedEvidence={onNeedEvidence}
          />

          {/* Disagreeing replaces the reviewer's conclusion with a different
              one, so it carries its own evidence and its own reasoning. */}
          {variance ? (
            <TrainerJustification
              row={row}
              callId={callId}
              session={session}
              note={note}
              onNote={setNote}
              onCommitNote={() => {
                if (note !== row.remark && row.value) void onDecide(row, row.value, note);
              }}
              onPlayClip={onPlayClip}
              onRefresh={onRefresh}
              speakers={speakers}
              segments={segments}
            />
          ) : (
            <>
              {(showNote || note) && (
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() => {
                    if (note !== row.remark && row.value) void onDecide(row, row.value, note);
                  }}
                  rows={2}
                  placeholder="Note for the reviewer — optional"
                  className="w-full border border-rule rounded px-2.5 py-2 bg-white text-[13px] mt-2.5"
                />
              )}
              {!showNote && !note && decided && (
                <button
                  onClick={() => setShowNote(true)}
                  className="text-[12px] text-ink-45 underline underline-offset-2 mt-2"
                >
                  Add a note
                </button>
              )}
            </>
          )}

          {/* Finished with this criterion — not with the calibration. Submit
              remains the only action that submits. */}
          {canFinish && (
            <div className="flex justify-end mt-3 pt-2.5 border-t border-rule-soft">
              <button
                onClick={() => onDone(row.criterion_id, true)}
                className="border border-ink rounded px-3.5 py-1.5 text-[12.5px] font-medium hover:bg-ground-2"
              >
                Done
              </button>
            </div>
          )}
          {decided && row.blocker && (
            <p className="text-[12px] text-[#96690A] mt-3 pt-2.5 border-t border-rule-soft">
              {row.blocker === "needs_evidence"
                ? "Cite what supports your decision to finish this criterion."
                : "Explain your disagreement to finish this criterion."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


/**
 * What the trainer must supply when replacing the reviewer's conclusion:
 * evidence and reasoning. Appears only on disagreement — agreement needs
 * neither, because the reviewer already did that work.
 */
function TrainerJustification({
  row,
  callId,
  session,
  note,
  onNote,
  onCommitNote,
  onPlayClip,
  onRefresh,
  speakers,
  segments,
}: {
  row: CalibrationRow;
  callId: string;
  session: Session;
  note: string;
  onNote: (v: string) => void;
  onCommitNote: () => void;
  onPlayClip?: (startMs: number, endMs: number) => void;
  onRefresh: () => Promise<void>;
  speakers: SpeakerMap;
  segments: Segment[];
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  // Selecting lines is the normal way in; typing a range stays available for
  // when the trainer knows the timestamp and Raw QA cited nothing.
  const [mode, setMode] = useState<"select" | "manual">("select");
  const [runs, setRuns] = useState<SelectionRun[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [quote, setQuote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const needsEvidence = row.trainer_evidence.length === 0;
  const needsReason = note.trim().length === 0;

  /**
   * Saves the trainer's evidence.
   *
   * One record per contiguous run, so two selections stay two passages with
   * their own timestamps. Merging them would claim the trainer cited the
   * silence in between.
   */
  async function citeSelection(): Promise<void> {
    if (runs.length === 0) {
      setError("Select the lines that support your decision.");
      return;
    }
    try {
      for (const run of runs) {
        await citeEvidence({
          orgId: session.person.org_id,
          personId: session.person.id,
          scoreId: row.score_id,
          callId,
          startMs: run.startMs,
          endMs: run.endMs,
          excerpt: run.excerpt,
        });
      }
      setRuns([]);
      setAdding(false);
      setError(null);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Manual fallback: the trainer types a range and the transcript is retrieved
   * for it. They should not have to transcribe what is already on screen.
   */
  async function citeManual(): Promise<void> {
    const startMs = parseClock(from);
    if (startMs === null) {
      setError("Give a start time like 9:22.");
      return;
    }
    const endMs = parseClock(to) ?? startMs + 20000;
    const found = excerptForRange(segments, startMs, endMs);

    // Typed text wins if the trainer wrote something; otherwise the retrieved
    // passage fills in. Only if neither exists is there nothing to cite.
    const excerpt = quote.trim() || found?.excerpt || "";
    if (!excerpt) {
      setError("No transcript lines fall in that range. Check the times, or paste the quote.");
      return;
    }
    try {
      await citeEvidence({
        orgId: session.person.org_id,
        personId: session.person.id,
        scoreId: row.score_id,
        callId,
        startMs: found?.startMs ?? startMs,
        endMs: found?.endMs ?? endMs,
        excerpt,
      });
      setFrom("");
      setTo("");
      setQuote("");
      setAdding(false);
      setError(null);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }


  async function adopt(ev: EvidenceItem): Promise<void> {
    try {
      await adoptReviewerEvidence(row.score_id, ev.id);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const adopted = new Set(
    row.trainer_evidence.map((e) => `${e.start_ms}-${e.end_ms}-${e.excerpt}`),
  );

  return (
    <div className="mt-3 border-t border-rule-soft pt-3">
      <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-2">
        What supports your decision
      </p>

      {error && <p className="text-[12.5px] text-[#AC3A2A] mb-2">{error}</p>}

      {row.trainer_evidence.length > 0 && (
        <ul className="space-y-1.5 mb-2.5">
          {row.trainer_evidence.map((ev) => (
            <li key={ev.id} className="border-l-2 border-accent pl-2.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                {ev.start_ms !== null && onPlayClip ? (
                  <button
                    onClick={() =>
                      onPlayClip(ev.start_ms ?? 0, ev.end_ms ?? (ev.start_ms ?? 0) + 15000)
                    }
                    className="font-mono text-[11.5px] text-accent hover:underline underline-offset-2"
                  >
                    &#9654; {formatClock(ev.start_ms)}
                    {ev.end_ms !== null && `–${formatClock(ev.end_ms)}`}
                  </button>
                ) : (
                  <span className="font-mono text-[11.5px] text-ink-45">
                    {formatClock(ev.start_ms)}
                  </span>
                )}
                <button
                  onClick={() => {
                    void removeEvidence(ev.id).then(onRefresh);
                  }}
                  className="text-[11px] text-ink-45 hover:text-[#AC3A2A] underline underline-offset-2"
                >
                  remove
                </button>
              </div>
              {ev.excerpt && (
                <p className="text-[12.5px] text-ink-70 leading-relaxed whitespace-pre-line">
                  &ldquo;{resolveSpeakersInText(ev.excerpt, speakers)}&rdquo;
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {needsEvidence && (
        <p className="text-[12px] text-[#96690A] mb-2">
          &#9888; Cite what supports your decision before this can be submitted.
        </p>
      )}

      {adding ? (
        <div className="border border-rule rounded bg-white px-3 py-2.5 mb-2.5">
          <div className="flex gap-3 mb-2 text-[12px]">
            <button
              type="button"
              onClick={() => setMode("select")}
              className={mode === "select" ? "font-semibold underline underline-offset-2" : "text-ink-45"}
            >
              Select from transcript
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={mode === "manual" ? "font-semibold underline underline-offset-2" : "text-ink-45"}
            >
              Enter a time
            </button>
          </div>

          {mode === "select" ? (
            segments.length > 0 ? (
              <TranscriptSelector
                segments={segments}
                speakers={speakers}
                onRunsChange={setRuns}
              />
            ) : (
              <p className="text-[12.5px] text-ink-45 mb-2">
                No transcript on this call yet &mdash; enter a time instead.
              </p>
            )
          ) : (
            <>
              <div className="flex gap-2 mb-2">
                <input
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  placeholder="9:22"
                  className="w-20 border border-rule rounded px-2 py-1.5 text-[13px] font-mono"
                />
                <span className="text-ink-45 self-center text-[13px]">to</span>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="9:35"
                  className="w-20 border border-rule rounded px-2 py-1.5 text-[13px] font-mono"
                />
              </div>
              {/* Retrieved, not transcribed. Shown before saving so the
                  trainer can see they picked the right passage. */}
              {(() => {
                const startMs = parseClock(from);
                const endMs = startMs === null ? null : parseClock(to) ?? startMs + 20000;
                const found =
                  startMs !== null && endMs !== null
                    ? excerptForRange(segments, startMs, endMs)
                    : null;
                return found ? (
                  <p className="text-[12.5px] bg-ground border border-rule-soft rounded px-2.5 py-2 mb-2 whitespace-pre-line">
                    {resolveSpeakersInText(found.excerpt, speakers)}
                  </p>
                ) : null;
              })()}
              <textarea
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                rows={2}
                placeholder="Transcript evidence — filled in from the times above where possible"
                className="w-full border border-rule rounded px-2.5 py-2 text-[13px] mb-2"
              />
            </>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => void (mode === "select" ? citeSelection() : citeManual())}
              className="bg-ink text-ground border border-ink rounded px-3 py-1.5 text-[12.5px]"
            >
              {mode === "select" && runs.length > 1
                ? `Cite ${runs.length} passages`
                : "Cite this"}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setRuns([]);
              }}
              className="border border-rule rounded px-3 py-1.5 text-[12.5px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2.5 flex-wrap mb-2.5">
          <button
            onClick={() => setAdding(true)}
            className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2"
          >
            Cite a passage
          </button>
          {/* Reusing the reviewer's citation is common and legitimate: the
              same quote can support a different conclusion. */}
          {row.raw_evidence
            .filter((ev) => !adopted.has(`${ev.start_ms}-${ev.end_ms}-${ev.excerpt}`))
            .map((ev) => (
              <button
                key={ev.id}
                onClick={() => void adopt(ev)}
                title={ev.excerpt}
                className="border border-rule-soft rounded px-3 py-1.5 text-[12.5px] text-ink-45 hover:bg-ground-2 hover:text-ink"
              >
                + use reviewer&rsquo;s {formatClock(ev.start_ms)}
              </button>
            ))}
        </div>
      )}

      <textarea
        value={note}
        onChange={(e) => onNote(e.target.value)}
        onBlur={onCommitNote}
        rows={2}
        placeholder="Why you decided differently — the reviewer will read this"
        className={`w-full border rounded px-2.5 py-2 bg-white text-[13px] ${
          needsReason ? "border-[#96690A]" : "border-rule"
        }`}
      />
      {needsReason && (
        <p className="text-[12px] text-[#96690A] mt-1">
          &#9888; A justification is required when you change an answer.
        </p>
      )}
    </div>
  );
}


/**
 * Capturing a teaching moment without leaving calibration.
 *
 * Uses evidence the trainer has already cited — theirs or the reviewer's,
 * since a reviewer may well have quoted exactly the right passage. If nothing
 * is cited yet, it sends them to the transcript picker first rather than
 * asking them to describe a clip that does not exist.
 */
function TeachThis({
  row,
  onPlayClip,
  onRefresh,
  onNeedEvidence,
}: {
  row: CalibrationRow;
  onPlayClip?: (startMs: number, endMs: number) => void;
  onRefresh: () => Promise<void>;
  onNeedEvidence: (row: CalibrationRow) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState("model");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both sides are teachable. The reviewer citing a passage does not stop it
  // being worth teaching — it often means it was worth noticing.
  const candidates = [
    ...row.trainer_evidence.map((e) => ({ ...e, from: "yours" })),
    ...row.raw_evidence.map((e) => ({ ...e, from: "reviewer's" })),
  ];

  function start(): void {
    if (candidates.length === 0) {
      onNeedEvidence(row);
      return;
    }
    setChosen(candidates[0]?.id ?? null);
    setOpen(true);
  }

  async function save(): Promise<void> {
    if (!chosen) return;
    setBusy(true);
    try {
      await momentFromEvidence({
        evidenceId: chosen,
        title: title.trim(),
        coachingNote: note.trim(),
        momentType: kind,
      });
      setOpen(false);
      setTitle("");
      setNote("");
      setDone(true);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-2">
        <button
          onClick={start}
          className="text-[12px] text-ink-45 underline underline-offset-2 hover:text-ink"
        >
          {done ? "Capture another teaching moment" : "+ Teaching moment"}
        </button>
        {done && (
          <span className="text-[11.5px] text-[#1F7A4D] ml-2">saved to the Library</span>
        )}
        {error && <p className="text-[12px] text-[#AC3A2A] mt-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-2.5 border border-ink rounded bg-card px-3.5 py-3">
      <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-2.5">
        New teaching moment
      </p>

      {error && <p className="text-[12.5px] text-[#AC3A2A] mb-2">{error}</p>}

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Name it so people can find it"
        className="w-full border border-rule rounded px-2.5 py-1.5 bg-white text-[13.5px] mb-2"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What should someone learn from this?"
        className="w-full border border-rule rounded px-2.5 py-2 bg-white text-[13px] mb-2"
      />

      <div className="flex gap-1.5 flex-wrap mb-2.5">
        {MOMENT_KINDS.map((k) => (
          <button
            key={k.value}
            onClick={() => setKind(k.value)}
            title={k.hint}
            className={`border rounded-full px-2.5 py-1 text-[12px] ${
              kind === k.value ? "bg-ink text-ground border-ink" : "border-rule hover:bg-ground-2"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <p className="text-[11.5px] text-ink-45 mb-1.5">
        Clip {candidates.length > 1 && "— pick which passage"}
      </p>
      <ul className="space-y-1 mb-3">
        {candidates.map((c) => (
          <li key={c.id}>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                checked={chosen === c.id}
                onChange={() => setChosen(c.id)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="font-mono text-[11.5px] text-accent">
                  {formatClock(c.start_ms)}
                  {c.end_ms !== null && `–${formatClock(c.end_ms)}`}
                </span>
                <span className="text-[11px] text-ink-45 ml-1.5">{c.from}</span>
                {c.start_ms !== null && onPlayClip && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      onPlayClip(c.start_ms ?? 0, c.end_ms ?? (c.start_ms ?? 0) + 15000);
                    }}
                    className="text-[11px] text-accent underline underline-offset-2 ml-2"
                  >
                    play
                  </button>
                )}
                {c.excerpt && (
                  <span className="block text-[12px] text-ink-70 leading-relaxed">
                    &ldquo;{c.excerpt}&rdquo;
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <button
          onClick={() => void save()}
          disabled={!title.trim() || !chosen || busy}
          className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save teaching moment"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="border border-rule rounded px-3.5 py-1.5 text-[12.5px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
