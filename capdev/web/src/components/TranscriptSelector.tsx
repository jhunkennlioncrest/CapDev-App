import { useState } from "react";
import { contiguousRuns, excerptFrom, type SelectionRun } from "@/lib/moments";
import type { Segment } from "@/lib/transcript";
import { formatDuration } from "@/lib/format";
import { shortSpeaker, type SpeakerMap } from "@/lib/speakers";

/**
 * Picking transcript lines.
 *
 * Extracted from ClipDialog rather than written again, so clip capture and
 * trainer evidence cannot drift apart in how a selection becomes a passage.
 * The important behaviour it carries with it: a gapped selection stays gapped.
 * Lines 7–9 and 34–36 are two passages, never one range spanning the silence
 * in between that nobody chose.
 */
export function TranscriptSelector({
  segments,
  speakers,
  onRunsChange,
  maxHeight = "max-h-56",
}: {
  segments: Segment[];
  speakers: SpeakerMap;
  onRunsChange: (runs: SelectionRun[]) => void;
  maxHeight?: string;
}): JSX.Element {
  const [selected, setSelected] = useState<number[]>([]);

  function apply(next: number[]): void {
    setSelected(next);
    onRunsChange(contiguousRuns(next, segments));
  }

  function toggleLine(i: number): void {
    apply(selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i]);
  }

  /** Shift-click extends from the first selection, for long passages. */
  function extendTo(i: number): void {
    if (selected.length === 0) {
      apply([i]);
      return;
    }
    const first = Math.min(...selected);
    const [lo, hi] = first < i ? [first, i] : [i, first];
    apply(Array.from({ length: hi - lo + 1 }, (_, k) => lo + k));
  }

  const runs = contiguousRuns(selected, segments);

  return (
    <div>
      <p className="text-[12px] text-ink-45 mb-1.5">
        Click the lines that support your decision. Shift-click to select a run.
      </p>

      <ul
        className={`border border-rule-soft rounded divide-y divide-rule-soft ${maxHeight} overflow-auto mb-2`}
      >
        {segments.map((seg, i) => {
          const isOn = selected.includes(i);
          return (
            <li key={seg.i}>
              <button
                type="button"
                onClick={(e) => (e.shiftKey ? extendTo(i) : toggleLine(i))}
                className={`w-full text-left px-2.5 py-1.5 flex gap-2.5 items-baseline hover:bg-ground ${
                  isOn ? "bg-ground-2" : ""
                }`}
              >
                <span className="font-mono text-[11px] text-ink-45 w-11 shrink-0 tabular-nums">
                  {seg.start_ms === null ? "—" : formatDuration(seg.start_ms)}
                </span>
                <span className="text-[12.5px]">
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

      {/* What will actually be saved, shown before committing rather than
          after — a gapped selection reads as two passages here. */}
      {runs.length > 0 && (
        <div className="mb-1">
          <p className="font-mono text-[11.5px] text-ink-45">
            {selected.length} line{selected.length === 1 ? "" : "s"}
            {runs.length > 1 && ` · ${runs.length} separate passages`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {runs.map((run, n) => (
              <li key={run.indices.join("-")} className="font-mono text-[11.5px]">
                {runs.length > 1 && (
                  <span className="text-ink-45 mr-1.5">Evidence {n + 1}</span>
                )}
                {formatDuration(run.startMs)}&ndash;{formatDuration(run.endMs)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The transcript passage covering a manually typed range.
 *
 * The fallback when Raw QA cited nothing and the trainer knows the timestamp
 * but shouldn't have to retype what was said. Returns null when no line falls
 * inside the range, so the trainer can still write it themselves.
 */
export function excerptForRange(
  segments: Segment[],
  startMs: number,
  endMs: number,
): { excerpt: string; startMs: number; endMs: number } | null {
  const inside = segments.filter(
    (s) =>
      s.start_ms !== null &&
      s.end_ms !== null &&
      // Any overlap counts: a typed range rarely lands exactly on a boundary.
      s.end_ms > startMs &&
      s.start_ms < endMs,
  );
  if (inside.length === 0) return null;

  const first = inside[0];
  const last = inside[inside.length - 1];
  return {
    excerpt: excerptFrom(inside),
    // Widened to whole lines, so playback never clips a word in half.
    startMs: Math.min(startMs, first?.start_ms ?? startMs),
    endMs: Math.max(endMs, last?.end_ms ?? endMs),
  };
}
