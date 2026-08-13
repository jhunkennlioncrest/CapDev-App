import { useState } from "react";
import {
  attachEvidence,
  createMoment,
  excerptFrom,
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

  const startMs = chosen.length ? (chosen[0]?.start_ms ?? null) : null;
  const endMs = chosen.length ? (chosen[chosen.length - 1]?.end_ms ?? null) : null;
  const excerpt = excerptFrom(chosen);

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
    if (chosen.length === 0) {
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
      let momentId: string | null = null;

      if (alsoMoment) {
        if (startMs === null || endMs === null) {
          throw new Error(
            "These lines have no timecodes, so they can't become a clip. They can still be evidence.",
          );
        }
        const moment = await createMoment({
          orgId: session.person.org_id,
          personId: session.person.id,
          callId,
          transcriptId,
          title,
          coachingNote: note,
          momentType,
          startMs,
          endMs,
          criterionIds,
          excerpt,
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
          startMs,
          endMs,
          excerpt,
          note: alsoMoment ? "" : note,
        });
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

          <p className="text-[13px] text-ink-70 mb-2">
            Click the lines that show it. Shift-click to select a run.
          </p>

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
                      {seg.speaker && <span className="font-semibold mr-1">{seg.speaker}:</span>}
                      {seg.text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {chosen.length > 0 && (
            <p className="font-mono text-[11.5px] text-ink-45 mb-4">
              {chosen.length} line{chosen.length === 1 ? "" : "s"} selected
              {startMs !== null && endMs !== null && (
                <>
                  {" · "}
                  {formatDuration(startMs)}–{formatDuration(endMs)} ({formatDuration(endMs - startMs)})
                </>
              )}
            </p>
          )}

          <label className="block mb-4">
            <span className="block text-[12px] font-semibold mb-1.5">
              Note <span className="font-normal text-ink-45">— why this matters</span>
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Listen for the pause before she answers."
              className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
            />
          </label>

          <label className="flex items-start gap-2.5 mb-1">
            <input
              type="checkbox"
              checked={alsoMoment}
              onChange={(e) => setAlsoMoment(e.target.checked)}
              className="mt-1"
            />
            <span className="text-[13px]">
              <span className="font-semibold">Also save as a teaching moment</span>
              <span className="text-ink-45">
                {" "}
                — reusable in coaching, not just proof for this score
              </span>
            </span>
          </label>

          {alsoMoment && (
            <div className="mt-3 border-l-2 border-rule pl-4 space-y-3">
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
