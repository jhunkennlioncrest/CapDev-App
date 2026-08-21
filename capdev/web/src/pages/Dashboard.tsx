import { useCallback, useEffect, useState } from "react";
import { CalibrationAccuracySection } from "@/pages/CalibrationAccuracySection";
import { supabase } from "@/lib/supabase";
import { listCalls, signedUrlFor } from "@/lib/calls";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";
import { UploadDialog } from "@/components/UploadDialog";
import type { CallListItem, Session } from "@/lib/types";
import { StatusPill } from "@/components/CallTimeline";

interface DashboardProps {
  session: Session;
  onOpenCall: (id: string) => void;
  onOpenMoments: () => void;
  onOpenQueue: () => void;
  onOpenRawReviews: () => void;
  onOpenRepository: () => void;
}

export function Dashboard({
  session,
  onOpenCall,
  onOpenMoments,
  onOpenQueue,
  onOpenRawReviews,
  onOpenRepository,
}: DashboardProps): JSX.Element {
  const [calls, setCalls] = useState<CallListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const canUpload = session.permissions.includes("call.upload");
  const first = session.person.display_name.split(" ")[0] || "there";

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setCalls(await listCalls());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totalMs = (calls ?? []).reduce((sum, c) => sum + (c.duration_ms ?? 0), 0);

  return (
    <div className="max-w-5xl mx-auto px-6 pb-20">
      <header className="pt-9 pb-6 border-b border-rule flex justify-between items-start gap-6 flex-wrap">
        <div>
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-45">
            Capability &amp; Development
          </p>
          <h1 className="font-display text-4xl mt-2">Good to see you, {first}</h1>
        </div>
        <div className="flex gap-2 items-center pt-1">
          {session.permissions.includes("raw_qa.submit") && (
            <button
              onClick={onOpenRawReviews}
              className="border border-rule rounded px-3.5 py-2 text-sm hover:bg-ground-2"
            >
              My raw reviews
            </button>
          )}
          {session.permissions.includes("calibration.perform") && (
            <button
              onClick={onOpenQueue}
              className="border border-rule rounded px-3.5 py-2 text-sm hover:bg-ground-2"
            >
              Ready for calibration
            </button>
          )}
          <button
            onClick={onOpenRepository}
            className="border border-rule rounded px-3.5 py-2 text-sm hover:bg-ground-2"
          >
            Repository
          </button>
          <button
            onClick={onOpenMoments}
            className="border border-rule rounded px-3.5 py-2 text-sm hover:bg-ground-2"
          >
            Moments
          </button>
          {canUpload && (
            <button
              onClick={() => setUploading(true)}
              className="bg-ink text-ground border border-ink rounded px-3.5 py-2 text-sm font-medium hover:opacity-85"
            >
              Upload a recording
            </button>
          )}
          <button
            onClick={() => void supabase.auth.signOut()}
            className="border border-rule rounded px-3 py-2 text-sm hover:bg-ground-2"
          >
            Sign out
          </button>
        </div>
      </header>

      {calls !== null && calls.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 border-b border-rule">
          <Figure value={String(calls.length)} caption="calls uploaded" />
          <Figure value={formatDuration(totalMs)} caption="total recorded" />
          <Figure
            value={String(calls.filter((c) => c.transcript_id !== null).length)}
            caption="with transcripts"
          />
        </div>
      )}

      {error && <p className="mt-6 text-[13px] text-[#AC3A2A]">{error}</p>}

      <div className="mt-8">
        {calls === null ? (
          <p className="text-ink-45 text-sm">Loading&hellip;</p>
        ) : calls.length === 0 ? (
          <EmptyState canUpload={canUpload} onUpload={() => setUploading(true)} />
        ) : (
          <ul className="space-y-2.5">
            {calls.map((call) => (
              <CallRow key={call.id} call={call} onOpen={() => onOpenCall(call.id)} />
            ))}
          </ul>
        )}
      </div>

      {/* Separate from the recordings above and from representative scoring:
          this measures the QA process, not the representative. */}
      <CalibrationAccuracySection session={session} onOpenCall={onOpenCall} />

      {uploading && (
        <UploadDialog
          session={session}
          onClose={() => setUploading(false)}
          onUploaded={() => void refresh()}
        />
      )}
    </div>
  );
}

function Figure({ value, caption }: { value: string; caption: string }): JSX.Element {
  return (
    <div className="py-4 pr-5 border-r border-rule-soft last:border-r-0">
      <span className="font-display text-3xl block leading-none mb-1.5">{value}</span>
      <span className="text-[12px] text-ink-45">{caption}</span>
    </div>
  );
}

function EmptyState({ canUpload, onUpload }: {
  canUpload: boolean;
  onUpload: () => void;
}): JSX.Element {
  return (
    <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
      <h2 className="font-display text-2xl mb-2">No recordings yet</h2>
      <p className="text-ink-70 max-w-md mx-auto mb-5">
        Start with a call you&rsquo;d want a rep to hear. Everything else &mdash; the
        transcript, the evaluation, the moments worth keeping &mdash; is built on
        top of what you upload here.
      </p>
      {canUpload && (
        <button
          onClick={onUpload}
          className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium hover:opacity-85"
        >
          Upload a recording
        </button>
      )}
    </div>
  );
}

function CallRow({ call, onOpen }: { call: CallListItem; onOpen: () => void }): JSX.Element {
  const [playing, setPlaying] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);

  async function play(): Promise<void> {
    if (!call.storage_path) return;
    if (url) {
      setPlaying(true);
      return;
    }
    setLoadingUrl(true);
    setUrl(await signedUrlFor(call.storage_path));
    setLoadingUrl(false);
    setPlaying(true);
  }

  return (
    <li className="bg-card border border-rule-soft rounded px-4 py-3.5">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <button onClick={onOpen} className="font-display text-lg truncate text-left hover:underline underline-offset-2">
              {call.title || "Untitled call"}
            </button>
            <StatusPill status={call.workflow_status} />
          </div>
          <p className="text-[12px] text-ink-45 mt-0.5">
            {call.agent_name || "Rep not set"} &middot; {call.customer_ref || "No reference"} &middot;{" "}
            {formatDate(call.occurred_at ?? call.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-[12px] text-ink-70">
            {formatDuration(call.duration_ms)}
          </span>
          <span className="font-mono text-[11px] text-ink-45">
            {formatBytes(call.size_bytes)}
          </span>
          {call.transcript_id ? (
            <span className="font-mono text-[11px] text-ink-45">
              {call.segment_count} lines
            </span>
          ) : (
            <span className="font-mono text-[11px] text-[#96690A]">no transcript</span>
          )}
          {call.storage_path ? (
            <button
              onClick={() => void play()}
              disabled={loadingUrl}
              className="border border-rule rounded px-3 py-1.5 text-[13px] hover:bg-ground-2 disabled:opacity-40"
            >
              {loadingUrl ? "Opening\u2026" : playing ? "Playing" : "Listen"}
            </button>
          ) : (
            <span className="text-[12px] text-[#96690A]">No audio</span>
          )}
          <button
            onClick={onOpen}
            className="bg-ink text-ground border border-ink rounded px-3 py-1.5 text-[13px] font-medium hover:opacity-85"
          >
            Open
          </button>
        </div>
      </div>

      {playing && url && (
        <audio controls autoPlay src={url} className="w-full mt-3" />
      )}
    </li>
  );
}
