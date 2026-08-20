import { useState } from "react";
import { useSpeakers } from "@/lib/useSpeakers";
import { shortSpeaker } from "@/lib/speakers";
import {
  attachEvidence,
  createMoment,
  contiguousRuns,
  MOMENT_TYPES,
  type MomentType,
} from "@/lib/moments";
import { formatDuration } from "@/lib/format";
import type { Segment } from "@/lib/transcript";
import type { Criterion } from "@/lib/evaluation";
import type { Session } from "@/lib/types";

interface Props {
  session: Session;
  callId: string;
  transcriptId: string | null;
  segments: Segment[];
  /** Score row this evidence supports, if opened from the evaluation. */
  scoreId?: string | null;
  criterion?: Criterion | null;
  allCriteria: Criterion[];
  /** Raw reviewers cite evidence but do not create teaching moments. */
  allowMoment?: boolean;
  /** Lets each range be previewed, bounded, before it is saved. */
  onPlayClip?: (startMs: number, endMs: number) => void;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Turns a transcript selection into evidence, and optionally into a reusable
 * teaching moment.
 *
 * The default is evidence only. Promoting to a moment is a deliberate extra
 * step, because a library of every cited span would be unusable — the value of
 * the moment library depends on it staying curated.
 */
export function ClipDialog({
  session,
  callId,
  transcriptId,
  segments,
  scoreId,
  criterion,
  allCriteria,
  allowMoment = true,
  onPlayClip,
  onClose,
  onSaved,
}: Props): JSX.Element {
  const [selected, setSelected] = useState<number[]>([]);
  const [alsoMoment, setAlsoMoment] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [momentType, setMomentType] = useState<MomentType>("model");
  const [criterionIds, setCriterionIds] = useState<string[]>(
    criterion ? [criterion.id] : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = selected
    .slice()
    .sort((a, b) => a - b)
    .map((i) => segments[i])
    .filter((s): s is Segment => !!s);

  // Each contiguous stretch is its own clip. A gap means the audio in between
  // was never cited, so first-to-last would play something nobody selected.
  const runs = contiguousRuns(selected, segments);
  // The same mapping the main transcript uses — not a private copy.
  const speakers = useSpeakers(callId);

  function toggleLine(i: number): void {
    setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
  }

  /** Shift-click extends from the first selection, for long passages. */
  function extendTo(i: number): void {
    if (selected.length === 0) {
      setSelected([i]);
      return;
    }
    const first = Math.min(...selected);
    const [lo, hi] = first < i ? [first, i] : [i, first];
    setSelected(Array.from({ length: hi - lo + 1 }, (_, k) => lo + k));
  }

  async function save(): Promise<void> {
    if (runs.length === 0) {
      setError("Select the lines this is about.");
      return;
    }
    if (alsoMoment && !title.trim()) {
      setError("A moment needs a name so people can find it later.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // One evidence record per selected range, so each stays independently
      // bounded and independently playable.
      for (const [n, run] of runs.entries()) {
        let momentId: string | null = null;

        if (alsoMoment) {
          if (run.startMs === null || run.endMs === null) {
            throw new Error(
              "These lines have no timecodes, so they can't become a clip. They can still be evidence.",
            );
          }
          const moment = await createMoment({
            orgId: session.person.org_id,
            personId: session.person.id,
            callId,
            transcriptId,
            // A moment is a single bounded clip, so a gapped selection makes
            // one per range rather than one clip spanning the gap.
            title: runs.length > 1 ? `${title} (${n + 1} of ${runs.length})` : title,
            coachingNote: note,
            momentType,
            startMs: run.startMs,
            endMs: run.endMs,
            criterionIds,
            excerpt: run.excerpt,
          });
          momentId = moment.id;
        }

        if (scoreId) {
          await attachEvidence({
            orgId: session.person.org_id,
            personId: session.person.id,
            scoreId,
            callId,
            transcriptId,
            momentId,
            startMs: run.startMs,
            endMs: run.endMs,
            excerpt: run.excerpt,
            note: alsoMoment ? "" : note,
          });
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center px-4"
      style={{ background: "rgba(22,33,29,0.42)" }}
    >
      <div className="w-full max-w-3xl bg-card border border-rule rounded max-h-[90vh] flex flex-col">
        <div className="px-6 pt-5 pb-4 border-b border-rule-soft flex justify-between items-start gap-4">
          <div>
            <h2 className="font-display text-2xl">
              {scoreId ? "Cite the evidence" : "Clip a moment"}
            </h2>
            {criterion && (
              <p className="text-[12px] text-ink-45 mt-1">
                <span className="font-mono">{criterion.code}</span> — {criterion.label || criterion.statement.slice(0, 60)}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="border border-rule rounded w-8 h-8 text-ink-70 hover:bg-ground-2 disabled:opacity-40"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 overflow-auto flex-1">
          {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

          <div className="mb-3">
            <p className="text-[13px] text-ink-70">
              <span className="font-semibold">Step 1.</span> Click the lines that show
              it. Shift-click to select a run.
            </p>
          </div>

          <ul className="border border-rule-soft rounded divide-y divide-rule-soft max-h-64 overflow-auto mb-4">
            {segments.map((seg, i) => {
              const isOn = selected.includes(i);
              return (
                <li key={seg.i}>
                  <button
                    onClick={(e) => (e.shiftKey ? extendTo(i) : toggleLine(i))}
                    className={`w-full text-left px-3 py-2 flex gap-3 items-baseline hover:bg-ground ${
                      isOn ? "bg-ground-2" : ""
                    }`}
                  >
                    <span className="font-mono text-[11px] text-ink-45 w-12 shrink-0 tabular-nums">
                      {seg.start_ms === null ? "—" : formatDuration(seg.start_ms)}
                    </span>
                    <span className="text-[13px]">
                      {seg.speaker && (
                          <span className="font-semibold mr-1">
                            {shortSpeaker(seg.speaker, speakers)}:
                          </span>
                        )}
                      {seg.text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Shows what will actually be saved. A gapped selection reads as
              two clips here, before it is committed, not after. */}
          {runs.length > 0 && (
            <div className="mb-4">
              <p className="font-mono text-[11.5px] text-ink-45">
                {chosen.length} line{chosen.length === 1 ? "" : "s"} selected
                {runs.length > 1 && ` · ${runs.length} separate clips`}
              </p>
              <ul className="mt-1 space-y-0.5">
                {runs.map((run, n) => (
                  <li key={run.indices.join("-")} className="font-mono text-[11.5px]">
                    {runs.length > 1 && (
                      <span className="text-ink-45 mr-1.5">Evidence {n + 1}</span>
                    )}
                    {run.startMs !== null && run.endMs !== null ? (
                      <button
                        onClick={() => onPlayClip?.(run.startMs!, run.endMs!)}
                        className="text-accent hover:underline underline-offset-2"
                        title="Play just this range"
                      >
                        &#9654; {formatDuration(run.startMs)}&ndash;{formatDuration(run.endMs)}
                      </button>
                    ) : (
                      <span className="text-ink-45">no timecode</span>
                    )}
                  </li>
                ))}
              </ul>
              {runs.length > 1 && (
                <p className="text-[11.5px] text-ink-45 mt-1">
                  Saved as {runs.length} separate clips. The audio between them
                  is not included.
                </p>
              )}
            </div>
          )}

          <label className="block mb-4">
            <span className="block text-[12px] font-semibold mb-1.5">
              <span className="font-semibold">Step 2.</span> Note{" "}
              <span className="font-normal text-ink-45">— why this matters</span>
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Listen for the pause before she answers."
              className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
            />
          </label>

          {allowMoment && (
          <div className="border border-rule-soft rounded bg-ground px-4 py-3">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={alsoMoment}
                onChange={(e) => setAlsoMoment(e.target.checked)}
                className="mt-1"
              />
              <span className="text-[13px]">
                <span className="font-semibold">Step 3 (optional). Also save as a teaching moment</span>
                <span className="block text-ink-45 mt-0.5">
                  Quotes stay with this evaluation. A teaching moment goes into the
                  library, where it can be reused for coaching any rep.
                </span>
              </span>
            </label>
          </div>
          )}

          {allowMoment && alsoMoment && (
            <div className="mt-3 border-l-2 border-ink pl-4 space-y-3">
              <label className="block">
                <span className="block text-[12px] font-semibold mb-1.5">
                  What happens here{" "}
                  <span className="font-normal text-ink-45">— how a rep would search for it</span>
                </span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Refund threat met with acknowledgment first"
                  className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
                />
              </label>

              <div>
                <span className="block text-[12px] font-semibold mb-1.5">
                  Why it&rsquo;s worth watching
                </span>
                <div className="flex gap-1.5 flex-wrap">
                  {MOMENT_TYPES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setMomentType(t.value)}
                      title={t.hint}
                      className={`border rounded px-3 py-1.5 text-[13px] ${
                        momentType === t.value
                          ? "bg-ink text-ground border-ink"
                          : "border-rule hover:bg-ground-2"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-[12px] font-semibold mb-1.5">
                  What it teaches{" "}
                  <span className="font-normal text-ink-45">— tag every criterion it touches</span>
                </span>
                <div className="flex gap-1.5 flex-wrap">
                  {allCriteria.map((c) => {
                    const on = criterionIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() =>
                          setCriterionIds((ids) =>
                            on ? ids.filter((x) => x !== c.id) : [...ids, c.id],
                          )
                        }
                        title={c.statement}
                        className={`border rounded-full px-2.5 py-1 font-mono text-[11px] ${
                          on ? "bg-ink text-ground border-ink" : "border-rule hover:bg-ground-2"
                        }`}
                      >
                        {c.code}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-rule-soft flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="border border-rule rounded px-3.5 py-2 text-sm hover:bg-ground-2"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || chosen.length === 0}
            className="bg-ink text-ground border border-ink rounded px-3.5 py-2 text-sm font-medium hover:opacity-85 disabled:opacity-40"
          >
            {saving ? "Saving…" : alsoMoment ? "Save evidence and moment" : "Save evidence"}
          </button>
        </div>
      </div>
    </div>
  );
}
