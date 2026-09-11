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
  /**
   * Verbatim from transcript.segments[].text. Never summarised, never
   * normalised, never inferred, never logged, never persisted - and never
   * substituted: a segment whose text is missing, null, non-string or wordless
   * makes the whole resolution refuse rather than yielding a placeholder.
   */
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
 * non-empty string (shortest: two characters).
 *
 * Missing speaker labels and missing timings are tolerated - they degrade a
 * line's attribution or its clickability, which the validator and the UI can
 * express honestly. Missing TEXT is not tolerated, because there is no honest
 * way to express "this segment said nothing" to a model that is being asked to
 * condense what was said.
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

    // Text is the one field with no safe fallback.
    //
    // This used to coerce a missing or non-string value to "". That is the
    // quietest possible corruption: an empty turn is shown to the model as a
    // real segment, the model can cite it as provenance, the validator - which
    // checks indexes, speakers and spans, not words - accepts the citation, and
    // a reviewer who clicks through to "the original" lands on nothing. A
    // Quick Listen that cites silence is worse than one that was never made.
    //
    // So both are terminal, and the refusal names only a position.
    const rawText = seg["text"];
    if (typeof rawText !== "string") {
      return {
        reason: "segment_text_invalid",
        detail: `segment at position ${pos} has a missing or non-string text value`,
      };
    }

    // Emptiness is judged on the TRIMMED value; the untrimmed original is what
    // gets stored. Judging on the raw string would accept "   " while refusing
    // "", and a segment of three spaces carries exactly as many words as one of
    // none. Trimming here decides; it never reaches the output.
    //
    // Refusing rather than accepting, deliberately. All 3,717 segments of all
    // 24 available Sandbox transcripts carry text, the shortest being two
    // characters, so no legitimate empty segment exists in this system today. A
    // wordless segment is either a diarisation artefact or a data-quality
    // problem, and in both cases a loud terminal failure with a code is better
    // than a silent citable void. If a real use case for empty segments ever
    // appears - a deliberate silence marker, say - this is the line to revisit,
    // and it should then be SKIPPED rather than accepted, so that it can never
    // be cited.
    if (rawText.trim() === "") {
      return {
        reason: "segment_text_empty",
        detail: `segment at position ${pos} carries no words`,
      };
    }

    out.push({
      i: pos,
      speaker_label: label,
      // Name and role come from the transcript's speaker map, keyed by this
      // segment's own label - the same resolution the fingerprint hashes, so a
      // rename invalidates the digest rather than silently changing who the
      // provider is told was speaking.
      name: who?.name ?? null,
      role: who?.role ?? null,
      // The stored string exactly as stored - leading and trailing whitespace
      // included. Validated above, never rewritten here.
      text: rawText,
      start_ms: num("start_ms") ?? num("start"),
      end_ms: num("end_ms") ?? num("end"),
    });
  }

  return out;
}
