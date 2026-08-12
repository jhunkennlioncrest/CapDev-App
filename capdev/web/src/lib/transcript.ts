/**
 * Transcript parsing.
 *
 * The platform is agnostic to how a transcript was produced (approved Version
 * 1.0 transcript strategy). Whether it came from Zoom, ElevenLabs, Whisper, or
 * a person typing it out, it becomes the same shape:
 *
 *   { i, start_ms, end_ms, speaker, text }
 *
 * Timing is optional throughout. A plain TXT file with no timecodes is a valid
 * transcript — it just cannot be clicked to seek, and the UI says so rather
 * than pretending otherwise.
 */

export interface Segment {
  i: number;
  start_ms: number | null;
  end_ms: number | null;
  speaker: string | null;
  text: string;
}

export type TranscriptFormat = "txt" | "srt" | "vtt" | "json";

export interface ParseResult {
  format: TranscriptFormat;
  segments: Segment[];
  hasTiming: boolean;
  speakers: string[];
  warnings: string[];
}

export class TranscriptParseError extends Error {}

export const ACCEPTED_TRANSCRIPT_EXTENSIONS = ".txt,.srt,.vtt,.json";
export const MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024;

/** "00:01:14,320" · "00:01:14.320" · "01:14.320" · "1:14" */
function timecodeToMs(raw: string): number | null {
  const cleaned = raw.trim().replace(",", ".");
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(cleaned);
  if (!match) return null;

  const [, h, m, s, frac] = match;
  const hours = h ? Number(h) : 0;
  const minutes = Number(m);
  const seconds = Number(s);
  // "5" means 500ms, not 5ms — pad to three digits before reading.
  const millis = frac ? Number(frac.padEnd(3, "0")) : 0;

  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

/** "Mara: I hear you." → speaker "Mara". Guards against splitting on a URL. */
function splitSpeaker(line: string): { speaker: string | null; text: string } {
  const match = /^\s*([A-Za-z0-9 _.'-]{1,40})\s*:\s*(.+)$/.exec(line);
  if (!match) return { speaker: null, text: line.trim() };
  const [, candidate, rest] = match;
  const name = (candidate ?? "").trim();

  // "See https://example.com" must not yield the speaker "See https".
  // A scheme immediately before the colon means this is a URL, not a speaker.
  if (/(^|\s)(https?|ftp|mailto|tel)$/i.test(name)) {
    return { speaker: null, text: line.trim() };
  }
  // A real speaker label is one to four words.
  if (name.split(/\s+/).length > 4) {
    return { speaker: null, text: line.trim() };
  }

  return { speaker: name, text: (rest ?? "").trim() };
}

function detectFormat(filename: string, content: string): TranscriptFormat {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "srt" || ext === "vtt" || ext === "json" || ext === "txt") {
    // Trust the content over the extension when they disagree — exports are
    // frequently misnamed.
    if (ext === "txt" && /^WEBVTT/m.test(content)) return "vtt";
    if (ext === "txt" && /-->/.test(content)) return "srt";
    return ext;
  }
  if (/^WEBVTT/m.test(content)) return "vtt";
  if (/-->/.test(content)) return "srt";
  if (content.trim().startsWith("[") || content.trim().startsWith("{")) return "json";
  return "txt";
}

/** SRT and VTT share cue structure; the differences are handled inline. */
function parseCues(content: string, format: "srt" | "vtt"): {
  segments: Segment[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const body = format === "vtt" ? content.replace(/^WEBVTT.*$/m, "") : content;

  const blocks = body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const segments: Segment[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const arrowIndex = lines.findIndex((l) => l.includes("-->"));
    if (arrowIndex === -1) continue; // NOTE / STYLE blocks in VTT

    const timing = lines[arrowIndex] ?? "";
    const [rawStart, rawEndPart] = timing.split("-->");
    // VTT cue settings trail the end timecode: "00:00:04.000 align:start"
    const rawEnd = (rawEndPart ?? "").trim().split(/\s+/)[0] ?? "";

    const start = timecodeToMs(rawStart ?? "");
    const end = timecodeToMs(rawEnd);

    const textLines = lines.slice(arrowIndex + 1).filter((l) => l.trim());
    if (textLines.length === 0) continue;

    const joined = textLines
      .join(" ")
      .replace(/<[^>]+>/g, "") // VTT inline tags
      .trim();

    const { speaker, text } = splitSpeaker(joined);
    if (!text) continue;

    segments.push({
      i: segments.length,
      start_ms: start,
      end_ms: end,
      speaker,
      text,
    });

    if (start === null) warnings.push(`Cue ${segments.length} has an unreadable timecode.`);
  }

  return { segments, warnings };
}

function parseJson(content: string): { segments: Segment[]; warnings: string[] } {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new TranscriptParseError("That file isn't valid JSON.");
  }

  // Accept a bare array or a common wrapper key.
  const rows: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown>)?.segments)
      ? ((data as Record<string, unknown>).segments as unknown[])
      : Array.isArray((data as Record<string, unknown>)?.utterances)
        ? ((data as Record<string, unknown>).utterances as unknown[])
        : Array.isArray((data as Record<string, unknown>)?.results)
          ? ((data as Record<string, unknown>).results as unknown[])
          : [];

  if (rows.length === 0) {
    throw new TranscriptParseError(
      "Couldn't find any transcript lines. Expected an array, or an object with " +
        "a segments, utterances, or results array.",
    );
  }

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const segments: Segment[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const text = String(r.text ?? r.transcript ?? r.content ?? "").trim();
    if (!text) continue;

    // Providers differ: milliseconds, seconds, or nested start/end objects.
    const startRaw = num(r.start_ms) ?? num(r.startMs) ?? num(r.start) ?? num(r.begin);
    const endRaw = num(r.end_ms) ?? num(r.endMs) ?? num(r.end);
    const looksLikeSeconds = startRaw !== null && startRaw < 10_000 && !("start_ms" in r);

    segments.push({
      i: segments.length,
      start_ms: startRaw === null ? null : Math.round(looksLikeSeconds ? startRaw * 1000 : startRaw),
      end_ms: endRaw === null ? null : Math.round(looksLikeSeconds ? endRaw * 1000 : endRaw),
      speaker: r.speaker ? String(r.speaker) : null,
      text,
    });
  }

  if (segments.length === 0) {
    throw new TranscriptParseError("No lines with text were found in that file.");
  }
  if (segments.every((s) => s.start_ms === null)) {
    warnings.push("No timing found — the transcript won't be clickable.");
  }

  return { segments, warnings };
}

function parsePlainText(content: string): { segments: Segment[]; warnings: string[] } {
  const lines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) throw new TranscriptParseError("That file is empty.");

  const segments = lines.map((line, i) => {
    const { speaker, text } = splitSpeaker(line);
    return { i, start_ms: null, end_ms: null, speaker, text };
  });

  return {
    segments,
    warnings: [
      "Plain text has no timecodes, so lines can't be clicked to jump the audio. " +
        "An SRT or VTT export would give you that.",
    ],
  };
}

export function parseTranscript(filename: string, content: string): ParseResult {
  if (!content.trim()) throw new TranscriptParseError("That file is empty.");

  const format = detectFormat(filename, content);

  const { segments, warnings } =
    format === "srt" || format === "vtt"
      ? parseCues(content, format)
      : format === "json"
        ? parseJson(content)
        : parsePlainText(content);

  if (segments.length === 0) {
    throw new TranscriptParseError(
      "Couldn't read any lines from that file. Check it's a transcript export.",
    );
  }

  const hasTiming = segments.some((s) => s.start_ms !== null);
  const speakers = [...new Set(segments.map((s) => s.speaker).filter((s): s is string => !!s))];

  // Out-of-order timing usually means a merged or hand-edited file.
  if (hasTiming) {
    const timed = segments.filter((s) => s.start_ms !== null);
    const outOfOrder = timed.some(
      (s, idx) => idx > 0 && (s.start_ms ?? 0) < (timed[idx - 1]?.start_ms ?? 0),
    );
    if (outOfOrder) warnings.push("Some timecodes run backwards — worth a look.");
  }

  if (speakers.length > 8) {
    warnings.push(
      `Found ${speakers.length} speakers, which is unusual — names may have been ` +
        "picked up from the text itself.",
    );
  }

  return { format, segments, hasTiming, speakers, warnings };
}
