/**
 * The Quick Listen script contract (0075 Phase 3A).
 *
 * Phase 1 wrote the provenance shape into a column comment. This is that
 * comment made executable, and it exists BEFORE the generator does on purpose:
 * a validator written after the fact gets quietly shaped by whatever the
 * generator happens to emit, and stops being a check.
 *
 * What it is defending against is a specific, likely failure. A language model
 * asked to condense a call will, sooner or later, produce a line that reads
 * perfectly and cites a segment that does not exist, or attributes one
 * speaker's words to another, or widens a timespan to cover material it did not
 * actually use. Every one of those produces a Quick Listen that sounds right
 * and is wrong, and a reviewer who clicks through to "the original" lands
 * somewhere that does not say what they were just told. That is worse than no
 * Quick Listen at all.
 *
 * So the rule is: every condensed line must be traceable to real source
 * segments, attributed to the speaker those segments belong to, and span
 * exactly the time those segments cover. A line that cannot prove its
 * provenance is rejected, and the whole script with it.
 *
 * Pure. No network, no database, no clock. Runs unchanged in Deno and in Node.
 */

/** One segment of the authoritative transcript, as the worker resolves it. */
export interface SourceSegment {
  /** Position in the transcript, 0-based. This is what source_i references. */
  i: number;
  speaker_label: string;
  name: string | null;
  role: string | null;
  /** Null when the transcript carries no timing (has_timing = false). */
  start_ms: number | null;
  end_ms: number | null;
}

/** One line of a generated Quick Listen script. */
export interface ScriptLine {
  n: number;
  speaker_label: string;
  name: string | null;
  role: string | null;
  text: string;
  source_i: number[];
  source_start_ms: number | null;
  source_end_ms: number | null;
  /** Set only once TTS has produced audio. Null through Phase 3. */
  audio_start_ms?: number | null;
  audio_end_ms?: number | null;
}

export interface Violation {
  /** Machine-readable. Safe to log and to store in error_message. */
  code: string;
  /** 1-based line number, or null for whole-script violations. */
  n: number | null;
  /** Human-readable, and deliberately free of transcript text. */
  detail: string;
}

/**
 * Returns every violation found. An empty array means the script satisfies the
 * contract.
 *
 * Deliberately returns ALL violations rather than throwing on the first. A
 * generator that got the shape wrong usually got it wrong repeatedly, and one
 * error at a time turns diagnosis into a dozen round trips.
 *
 * No message produced here contains transcript text, a speaker name or line
 * content - only indexes, counts and labels. These strings end up in logs and
 * in call_digest.error_message, and neither may carry client content.
 */
export function validateScript(
  script: unknown,
  source: SourceSegment[],
): Violation[] {
  const v: Violation[] = [];
  const fail = (code: string, n: number | null, detail: string) =>
    v.push({ code, n, detail });

  if (!Array.isArray(script)) {
    fail("script_not_array", null, "script must be an array");
    return v;
  }
  if (script.length === 0) {
    fail("script_empty", null, "script must contain at least one line");
    return v;
  }

  const byIndex = new Map<number, SourceSegment>();
  for (const s of source) byIndex.set(s.i, s);

  const seenN = new Set<number>();

  script.forEach((rawLine, pos) => {
    const line = rawLine as Partial<ScriptLine>;
    const at = pos + 1; // position in the array, used when n itself is unusable

    /* ---- n: sequential, unique, in order ------------------------------- */
    if (typeof line.n !== "number" || !Number.isInteger(line.n)) {
      fail("n_not_integer", at, `line at position ${at} has a non-integer n`);
      return; // everything below reports against n; without it, stop here
    }
    const n = line.n;
    if (seenN.has(n)) {
      fail("n_duplicate", n, `n ${n} appears more than once`);
    }
    seenN.add(n);
    if (n !== at) {
      // Covers gaps, restarts and out-of-order arrays in one test: the array is
      // the order, so n must be the array position, 1-based.
      fail("n_out_of_sequence", n, `n ${n} found at array position ${at}; n must be sequential from 1`);
    }

    /* ---- text ---------------------------------------------------------- */
    if (typeof line.text !== "string" || line.text.trim() === "") {
      fail("text_empty", n, `line ${n} has no text`);
    }

    /* ---- provenance: source_i ------------------------------------------ */
    if (!Array.isArray(line.source_i) || line.source_i.length === 0) {
      fail("source_i_empty", n, `line ${n} cites no source segments`);
      return; // nothing further can be checked without provenance
    }

    const refs: SourceSegment[] = [];
    let invented = 0;
    for (const idx of line.source_i) {
      if (typeof idx !== "number" || !Number.isInteger(idx)) {
        fail("source_i_not_integer", n, `line ${n} cites a non-integer source index`);
        continue;
      }
      const seg = byIndex.get(idx);
      if (!seg) {
        invented += 1;
        continue;
      }
      refs.push(seg);
    }
    if (invented > 0) {
      // The failure that matters most: a citation to something that was never
      // said. Count only - never echo the index's content.
      fail("source_i_invented", n, `line ${n} cites ${invented} source index(es) not present in the authoritative transcript`);
    }
    if (refs.length === 0) {
      fail("source_i_unresolvable", n, `line ${n} resolves to no real source segments`);
      return;
    }

    /* ---- speaker identity must follow the source ------------------------ */
    const labels = new Set(refs.map((r) => r.speaker_label));
    if (labels.size > 1) {
      // One condensed line may merge several turns by the SAME speaker. Merging
      // two speakers into one line misattributes what was said.
      fail("speaker_mixed_sources", n, `line ${n} cites segments from ${labels.size} different speakers`);
    } else {
      const srcLabel = refs[0]!.speaker_label;
      if (line.speaker_label !== srcLabel) {
        fail("speaker_label_mismatch", n, `line ${n} is attributed to a different speaker label than the segments it cites`);
      }
      const srcName = refs[0]!.name ?? null;
      const srcRole = refs[0]!.role ?? null;
      if ((line.name ?? null) !== srcName) {
        fail("speaker_name_mismatch", n, `line ${n} carries a speaker name that does not match the source for that label`);
      }
      if ((line.role ?? null) !== srcRole) {
        fail("speaker_role_mismatch", n, `line ${n} carries a speaker role that does not match the source for that label`);
      }
    }

    /* ---- provenance span must match what it cites ----------------------- */
    const timed = refs.filter((r) => r.start_ms !== null && r.end_ms !== null);

    if (timed.length === 0) {
      // Untimed transcript: the only honest span is no span. Inventing one
      // would give a reviewer a position to click that means nothing.
      if (line.source_start_ms !== null && line.source_start_ms !== undefined) {
        fail("span_on_untimed_source", n, `line ${n} declares a source span but its segments carry no timing`);
      }
      if (line.source_end_ms !== null && line.source_end_ms !== undefined) {
        fail("span_on_untimed_source", n, `line ${n} declares a source span but its segments carry no timing`);
      }
    } else if (timed.length !== refs.length) {
      fail("span_partial_timing", n, `line ${n} cites a mix of timed and untimed segments`);
    } else {
      const start = line.source_start_ms;
      const end = line.source_end_ms;
      if (typeof start !== "number" || !Number.isInteger(start) || start < 0) {
        fail("span_start_invalid", n, `line ${n} has a missing or invalid source_start_ms`);
      } else if (typeof end !== "number" || !Number.isInteger(end) || end < 0) {
        fail("span_end_invalid", n, `line ${n} has a missing or invalid source_end_ms`);
      } else if (start > end) {
        fail("span_reversed", n, `line ${n} has source_start_ms after source_end_ms`);
      } else {
        const expectedStart = Math.min(...timed.map((r) => r.start_ms as number));
        const expectedEnd = Math.max(...timed.map((r) => r.end_ms as number));
        if (start !== expectedStart || end !== expectedEnd) {
          // Exact, not "contained within". A span wider than the cited segments
          // claims provenance over material the line did not use; a narrower one
          // points a reviewer at part of the evidence and hides the rest.
          fail("span_mismatch", n, `line ${n} declares a span that is not the exact extent of the segments it cites`);
        }
      }
    }

    /* ---- audio span: absent through Phase 3, coherent if present -------- */
    const aStart = line.audio_start_ms ?? null;
    const aEnd = line.audio_end_ms ?? null;
    if (aStart !== null || aEnd !== null) {
      if (typeof aStart !== "number" || !Number.isInteger(aStart) || aStart < 0) {
        fail("audio_start_invalid", n, `line ${n} has an invalid audio_start_ms`);
      } else if (typeof aEnd !== "number" || !Number.isInteger(aEnd) || aEnd < 0) {
        fail("audio_end_invalid", n, `line ${n} has an invalid audio_end_ms`);
      } else if (aStart > aEnd) {
        fail("audio_reversed", n, `line ${n} has audio_start_ms after audio_end_ms`);
      }
    }
  });

  return v;
}

/**
 * A one-line, content-free summary safe for error_message and logs: the codes
 * and how many times each fired, never the detail strings.
 */
export function summariseViolations(violations: Violation[]): string {
  if (violations.length === 0) return "valid";
  const counts = new Map<string, number>();
  for (const v of violations) counts.set(v.code, (counts.get(v.code) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([code, n]) => `${code}x${n}`)
    .join(",");
}
