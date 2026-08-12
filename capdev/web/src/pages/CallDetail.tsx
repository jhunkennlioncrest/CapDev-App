import { useCallback, useEffect, useRef, useState } from "react";
import { getCall, getTranscript, saveTranscript, signedUrlFor } from "@/lib/calls";
import type { CallListItem, Session } from "@/lib/types";
import type { StoredTranscript } from "@/lib/calls";
import {
  ACCEPTED_TRANSCRIPT_EXTENSIONS,
  MAX_TRANSCRIPT_BYTES,
  parseTranscript,
  TranscriptParseError,
  type ParseResult,
} from "@/lib/transcript";
import { formatDuration, formatDate } from "@/lib/format";

interface Props {
  callId: string;
  session: Session;
  onBack: () => void;
}

export function CallDetail({ callId, session, onBack }: Props): JSX.Element {
  const [call, setCall] = useState<CallListItem | null>(null);
  const [transcript, setTranscript] = useState<StoredTranscript | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const [followAlong, setFollowAlong] = useState(true);

  const canUpload = session.permissions.includes("call.upload");

  const load = useCallback(async (): Promise<void> => {
    try {
      const [c, t] = await Promise.all([getCall(callId), getTranscript(callId)]);
      setCall(c);
      setTranscript(t);
      if (c?.storage_path) setAudioUrl(await signedUrlFor(c.storage_path));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [callId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the playing line in view, unless the reader has taken over scrolling.
  useEffect(() => {
    if (followAlong) {
      activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [currentMs, followAlong]);

  function seekTo(ms: number | null): void {
    if (ms === null || !audioRef.current) return;
    audioRef.current.currentTime = ms / 1000;
    void audioRef.current.play();
    setFollowAlong(true);
  }

  const segments = transcript?.segments ?? [];

  // The last line whose start time has already passed. Written as a reverse
  // scan rather than findLastIndex so it works on older browsers too.
  let activeIndex = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (s && s.start_ms !== null && s.start_ms <= currentMs) {
      activeIndex = i;
      break;
    }
  }

  if (loading) {
    return <p className="max-w-5xl mx-auto px-6 py-10 text-ink-45 text-sm">Loading&hellip;</p>;
  }
  if (!call) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-10">
        <button onClick={onBack} className="text-[13px] text-ink-45 underline">
          &larr; Back
        </button>
        <p className="mt-4">That call couldn&rsquo;t be found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 pb-20">
      <header className="pt-8 pb-5 border-b border-rule">
        <button onClick={onBack} className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2">
          &larr; All calls
        </button>
        <h1 className="font-display text-3xl mt-3">{call.title || "Untitled call"}</h1>
        <p className="text-[12px] text-ink-45 mt-1">
          {call.agent_name || "Rep not set"} &middot; {call.customer_ref || "No reference"} &middot;{" "}
          {formatDate(call.occurred_at ?? call.created_at)} &middot;{" "}
          <span className="font-mono">{formatDuration(call.duration_ms)}</span>
        </p>
      </header>

      {error && <p className="mt-5 text-[13px] text-[#AC3A2A]">{error}</p>}

      {audioUrl ? (
        <div className="sticky top-0 z-10 bg-ground pt-4 pb-3 border-b border-rule-soft">
          <audio
            ref={audioRef}
            controls
            src={audioUrl}
            className="w-full"
            onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
          />
        </div>
      ) : (
        <p className="mt-5 text-[13px] text-[#96690A]">No audio attached to this call.</p>
      )}

      <div className="mt-6">
        {transcript ? (
          <>
            <div className="flex justify-between items-baseline gap-4 mb-3 flex-wrap">
              <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
                Transcript &middot; {transcript.segment_count} lines &middot;{" "}
                {transcript.source_format.toUpperCase()}
                {transcript.version_no > 1 && ` · v${transcript.version_no}`}
              </p>
              {!transcript.has_timing && (
                <span className="text-[12px] text-[#96690A]">
                  No timecodes &mdash; lines can&rsquo;t be clicked
                </span>
              )}
            </div>

            <ul
              className="bg-card border border-rule-soft rounded divide-y divide-rule-soft max-h-[60vh] overflow-auto"
              onWheel={() => setFollowAlong(false)}
            >
              {segments.map((seg, i) => {
                const active = i === activeIndex;
                return (
                  <li
                    key={seg.i}
                    ref={active ? activeRef : null}
                    onClick={() => seekTo(seg.start_ms)}
                    className={`px-4 py-2.5 flex gap-3 items-baseline ${
                      seg.start_ms !== null ? "cursor-pointer hover:bg-ground" : ""
                    } ${active ? "bg-ground-2" : ""}`}
                  >
                    <span className="font-mono text-[11px] text-ink-45 w-14 shrink-0 tabular-nums">
                      {seg.start_ms === null ? "—" : formatDuration(seg.start_ms)}
                    </span>
                    <span className="min-w-0">
                      {seg.speaker && (
                        <span className="font-semibold text-[13px] mr-1.5">{seg.speaker}:</span>
                      )}
                      <span className="text-[14px] text-ink-70">{seg.text}</span>
                    </span>
                  </li>
                );
              })}
            </ul>

            {canUpload && (
              <div className="mt-3">
                <TranscriptUploader
                  call={call}
                  session={session}
                  onSaved={() => void load()}
                  label="Replace transcript"
                  compact
                />
              </div>
            )}
          </>
        ) : canUpload ? (
          <TranscriptUploader
            call={call}
            session={session}
            onSaved={() => void load()}
            label="Add a transcript"
          />
        ) : (
          <p className="text-ink-45 text-sm">No transcript yet.</p>
        )}
      </div>
    </div>
  );
}

function TranscriptUploader({
  call,
  session,
  onSaved,
  label,
  compact = false,
}: {
  call: CallListItem;
  session: Session;
  onSaved: () => void;
  label: string;
  compact?: boolean;
}): JSX.Element {
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function choose(file: File): Promise<void> {
    setError(null);
    setPreview(null);

    if (file.size > MAX_TRANSCRIPT_BYTES) {
      setError("That transcript is larger than 10 MB.");
      return;
    }
    try {
      const text = await file.text();
      setPreview(parseTranscript(file.name, text));
      setFilename(file.name);
    } catch (err) {
      setError(
        err instanceof TranscriptParseError
          ? err.message
          : `Couldn't read that file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function save(): Promise<void> {
    if (!preview) return;
    setSaving(true);
    try {
      await saveTranscript({
        callId: call.id,
        orgId: session.person.org_id,
        personId: session.person.id,
        recordingId: call.recording_id,
        format: preview.format,
        filename,
        segments: preview.segments,
      });
      setPreview(null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={compact ? "" : "border border-dashed border-rule rounded bg-card px-8 py-10 text-center"}>
      {!compact && (
        <>
          <h2 className="font-display text-2xl mb-2">No transcript yet</h2>
          <p className="text-ink-70 max-w-md mx-auto mb-5">
            Upload one exported from Zoom, Teams, or any transcription tool. SRT
            and VTT keep their timecodes, so every line becomes clickable.
          </p>
        </>
      )}

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      {preview ? (
        <div className={`text-left ${compact ? "border border-rule-soft rounded bg-card p-4" : ""}`}>
          <p className="text-[13px] mb-1">
            <span className="font-semibold">{filename}</span>{" "}
            <span className="text-ink-45">
              &middot; {preview.segments.length} lines &middot; {preview.format.toUpperCase()}
              {preview.hasTiming ? " · timecoded" : " · no timecodes"}
              {preview.speakers.length > 0 && ` · ${preview.speakers.join(", ")}`}
            </span>
          </p>
          {preview.warnings.map((w) => (
            <p key={w} className="text-[12px] text-[#96690A] mt-1">
              {w}
            </p>
          ))}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium hover:opacity-85 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save transcript"}
            </button>
            <button
              onClick={() => setPreview(null)}
              disabled={saving}
              className="border border-rule rounded px-3.5 py-1.5 text-[13px] hover:bg-ground-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className={
            compact
              ? "text-[13px] text-ink-45 underline underline-offset-2 hover:text-ink"
              : "bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium hover:opacity-85"
          }
        >
          {label}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TRANSCRIPT_EXTENSIONS}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void choose(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
