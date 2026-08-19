import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adoptReviewerEvidence,
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
}: {
  evaluationId: string;
  callId: string;
  session: Session;
  /** Bounded playback: starts at the quote and stops at its end. */
  onPlayClip?: (startMs: number, endMs: number) => void;
  onCountsChanged?: (decided: number, total: number) => void;
}): JSX.Element {
  const [rows, setRows] = useState<CalibrationRow[]>([]);
  const [summary, setSummary] = useState<CalibrationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [r, s] = await Promise.all([
        getCalibrationRows(evaluationId),
        getSummary(evaluationId),
      ]);
      setRows(r);
      setSummary(s);
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
                    <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mt-4 mb-2">
                      {row.stage}
                    </p>
                  )}
                  <CriterionRow
                    row={row}
                    callId={callId}
                    session={session}
                    onDecide={onDecide}
                    onPlayClip={onPlayClip}
                    onRefresh={load}
                  />
                </div>
              );
            })}
          </section>
        );
      })}
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
}: {
  row: CalibrationRow;
  callId: string;
  session: Session;
  onDecide: (row: CalibrationRow, value: Answer, note?: string) => Promise<void>;
  onPlayClip?: (startMs: number, endMs: number) => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [note, setNote] = useState(row.remark);
  const [showNote, setShowNote] = useState(false);
  const [showGuidance, setShowGuidance] = useState(false);

  useEffect(() => setNote(row.remark), [row.remark]);

  const decided = Boolean(row.calibrated_at);
  const variance = row.variance && row.variance !== "agreed" ? row.variance : null;
  const spec = variance ? VARIANCE_LABELS[variance] : null;

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
                      <p className="text-[12.5px] text-ink-70 leading-relaxed mt-0.5">
                        &ldquo;{ev.excerpt}&rdquo;
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
}: {
  row: CalibrationRow;
  callId: string;
  session: Session;
  note: string;
  onNote: (v: string) => void;
  onCommitNote: () => void;
  onPlayClip?: (startMs: number, endMs: number) => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [quote, setQuote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const needsEvidence = row.trainer_evidence.length === 0;
  const needsReason = note.trim().length === 0;

  async function cite(): Promise<void> {
    const startMs = parseClock(from);
    if (startMs === null) {
      setError("Give a start time like 9:22.");
      return;
    }
    try {
      await citeEvidence({
        orgId: session.person.org_id,
        personId: session.person.id,
        scoreId: row.score_id,
        callId,
        startMs,
        endMs: parseClock(to) ?? startMs + 20000,
        excerpt: quote.trim(),
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
                <p className="text-[12.5px] text-ink-70 leading-relaxed">
                  &ldquo;{ev.excerpt}&rdquo;
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
          <textarea
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            rows={2}
            placeholder="What was said"
            className="w-full border border-rule rounded px-2.5 py-2 text-[13px] mb-2"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void cite()}
              className="bg-ink text-ground border border-ink rounded px-3 py-1.5 text-[12.5px]"
            >
              Cite this
            </button>
            <button
              onClick={() => setAdding(false)}
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
