/**
 * Turning the stored transcript into what a condensation provider receives
 * (0075 Phase 3A hardening).
 *
 * Pure: no network, no database, no clock. Separated from worker.ts for the
 * same reason staleness.ts and scriptContract.ts are separate - this is the
 * step that decides what a model will be shown, and "does it carry the real
 * words, in the real order, attributed to the real speaker" is a question that
 * should be answerable by a test rather than by reading the worker.
 */

import type { SourceSegment } from "./scriptContract.ts";

/**
 * A transcript segment as a condensation provider will receive it: the
 * provenance fields the validator checks, plus the actual dialogue.
 *
 * `extends SourceSegment` rather than a parallel type, deliberately. It means a
 * ProviderSegment[] is directly usable as a SourceSegment[], so the array the
 * model is shown and the array the validator resolves source_i against are
 * THE SAME ARRAY. Two independently built lists could drift - a filtered
 * segment here, a re-index there - and a script would then validate against
 * segments the model never read, which is exactly the class of silent
 * provenance failure this feature exists to prevent.
 */
export interface ProviderSegment extends SourceSegment {
  /** Verbatim from transcript.segments[].text. Never summarised, never
   *  normalised, never inferred, never logged, never persisted. */
  text: string;
}

export interface SpeakerEntry {
  label: string;
  name: string | null;
  role: string | null;
}

export interface SegmentRefusal {
  reason: string;
  detail: string;
}

/**
 * Resolves stored segments into provider segments, or refuses.
 *
 * Stored shape, confirmed against all 3,717 segments of all 24 available
 * Sandbox transcripts: `{ i, speaker, text, start_ms, end_ms }`, with `i`
 * always equal to the array position, `i` never null, and `text` always a
 * non-empty string. This accepts that shape and tolerates its absence rather
 * than assuming it.
 *
 * Order is the array's order, preserved exactly. `i` is the array position, so
 * a citation always means "the nth segment of this transcript".
 */
export function resolveProviderSegments(
  raw: unknown,
  speakers: SpeakerEntry[],
): ProviderSegment[] | SegmentRefusal {
  const list = Array.isArray(raw) ? raw : [];
  const byLabel = new Map(speakers.map((s) => [s.label, s]));
  const out: ProviderSegment[] = [];

  for (let pos = 0; pos < list.length; pos += 1) {
    const seg = (list[pos] ?? {}) as Record<string, unknown>;

    // The segment's own index wins when it has one, because that is the
    // transcript's own statement of what a citation means. If it has one and it
    // DISAGREES with the array position, refuse: a source_i would then be
    // ambiguous, and an ambiguous citation is worse than no Quick Listen.
    const storedI = seg["i"];
    if (typeof storedI === "number" && Number.isInteger(storedI) && storedI !== pos) {
      return {
        reason: "segment_index_inconsistent",
        detail: "the transcript's segment indexes do not match their order, so a citation would be ambiguous",
      };
    }

    const rawLabel = typeof seg["speaker"] === "string"
      ? (seg["speaker"] as string)
      : typeof seg["speaker_label"] === "string"
        ? (seg["speaker_label"] as string)
        : "";
    const label = rawLabel.trim();
    const who = byLabel.get(label);

    const num = (k: string): number | null => {
      const v = seg[k];
      return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
    };

    out.push({
      i: pos,
      speaker_label: label,
      // Name and role come from the transcript's speaker map, keyed by this
      // segment's own label - the same resolution the fingerprint hashes, so a
      // rename invalidates the digest rather than silently changing who the
      // provider is told was speaking.
      name: who?.name ?? null,
      role: who?.role ?? null,
      // Verbatim. Not trimmed, not collapsed, not defaulted to a placeholder:
      // the provider must condense what was actually said, and a silent
      // substitution here would be invisible in the output.
      text: typeof seg["text"] === "string" ? (seg["text"] as string) : "",
      start_ms: num("start_ms") ?? num("start"),
      end_ms: num("end_ms") ?? num("end"),
    });
  }

  return out;
}
