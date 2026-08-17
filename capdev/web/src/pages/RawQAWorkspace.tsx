import { useCallback, useEffect, useState } from "react";
import { SubNav } from "@/components/AppShell";
import { UploadDialog } from "@/components/UploadDialog";
import { getRawWorklist, type RawWorklistItem } from "@/lib/workflow";
import { listPlaylists, getPlaylistContents, type PlaylistSummary, type PlaylistCall } from "@/lib/playlists";
import { formatDate, formatDuration } from "@/lib/format";
import type { Session } from "@/lib/types";

type Tab = "todo" | "submitted";

interface Props {
  session: Session;
  onOpenCall: (id: string) => void;
}

/**
 * Raw QA workspace — the reviewer's whole world.
 *
 * Deliberately two tabs, not four. "My drafts" and "to review" are the same
 * question ("what should I do now"), and playlists are shown as what they are:
 * completed work, already filed. The reviewer never creates or manages one.
 */
export function RawQAWorkspace({ session, onOpenCall }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>("todo");
  const [todo, setTodo] = useState<RawWorklistItem[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [contents, setContents] = useState<Record<string, PlaylistCall[]>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [w, p] = await Promise.all([getRawWorklist(), listPlaylists("raw_qa")]);
      setTodo(w);
      setPlaylists(p.filter((x) => x.created_by === session.person.id || x.call_count > 0));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [session.person.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(id: string): Promise<void> {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!contents[id]) {
      setContents((c) => ({ ...c, [id]: [] }));
      const rows = await getPlaylistContents(id);
      setContents((c) => ({ ...c, [id]: rows }));
    }
  }

  const drafts = todo.filter((t) => t.draft_evaluation_id !== null).length;
  const submittedTotal = playlists.reduce((s, p) => s + p.call_count, 0);

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <header className="pt-8 pb-5 flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Raw QA</h1>
          <p className="text-ink-70 text-[14px] mt-1 max-w-xl">
            Listen, and record what you observe against each criterion. A trainer
            decides the outcome afterwards.
          </p>
        </div>
        <button
          onClick={() => setUploadOpen(true)}
          className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium hover:opacity-85"
        >
          Upload a recording
        </button>
      </header>

      <SubNav
        tabs={[
          { key: "todo" as const, label: "To review", count: todo.length },
          { key: "submitted" as const, label: "Submitted", count: submittedTotal },
        ]}
        active={tab}
        onChange={setTab}
      />

      {error && <p className="text-[13px] text-[#AC3A2A] mb-4">{error}</p>}

      {loading ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : tab === "todo" ? (
        todo.length === 0 ? (
          <Empty
            title="Nothing to review"
            body="Upload a recording to get started. It appears here straight away, and you can generate its transcript from the call."
            onUpload={() => setUploadOpen(true)}
          />
        ) : (
          <>
            {drafts > 0 && (
              <p className="text-[12.5px] text-ink-45 mb-2.5">
                {drafts} started but not submitted.
              </p>
            )}
            <ul className="space-y-2.5">
              {todo.map((t) => (
                <li
                  key={t.call_id}
                  className="bg-card border border-rule-soft rounded px-4 py-3.5 flex justify-between items-start gap-4 flex-wrap"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2.5 flex-wrap">
                      <h3 className="font-display text-lg">{t.call_title}</h3>
                      {t.next_step === "in_progress" && (
                        <span className="text-[11px] border border-[#96690A] text-[#96690A] rounded-full px-2 py-0.5">
                          In progress
                        </span>
                      )}
                      {t.next_step === "transcription_failed" && (
                        <span className="text-[11px] border border-[#AC3A2A] text-[#AC3A2A] rounded-full px-2 py-0.5">
                          Transcription failed
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-ink-45 mt-0.5">
                      {t.agent_name || "Rep not set"} &middot; uploaded {formatDate(t.uploaded_at)}
                      {t.duration_ms ? ` · ${formatDuration(t.duration_ms)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`font-mono text-[11.5px] ${
                        t.next_step === "ready" || t.next_step === "in_progress"
                          ? "text-ink-45"
                          : "text-[#96690A]"
                      }`}
                    >
                      {stepLabel(t)}
                    </span>
                    <button
                      onClick={() => onOpenCall(t.call_id)}
                      className={`rounded px-3.5 py-1.5 text-[13px] font-medium ${
                        t.next_step === "ready" || t.next_step === "in_progress"
                          ? "bg-ink text-ground border border-ink hover:opacity-85"
                          : "border border-rule hover:bg-ground-2"
                      }`}
                    >
                      {t.next_step === "in_progress"
                        ? "Continue"
                        : t.next_step === "ready"
                          ? "Start"
                          : "Open"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )
      ) : playlists.length === 0 ? (
        <Empty
          title="Nothing submitted yet"
          body="Your completed reviews collect here automatically, grouped by week. You don't need to file anything."
        />
      ) : (
        <>
          <p className="text-[12.5px] text-ink-45 mb-3">
            Your completed reviews, grouped automatically. A trainer works from these.
          </p>
          <ul className="space-y-2.5">
            {playlists.map((p) => (
              <li key={p.id} className="bg-card border border-rule-soft rounded">
                <button
                  onClick={() => void toggle(p.id)}
                  className="w-full px-4 py-3.5 flex justify-between items-center gap-4 text-left"
                >
                  <div className="min-w-0">
                    <h3 className="font-display text-lg">{p.name}</h3>
                    <p className="text-[12px] text-ink-45 mt-0.5">
                      {p.call_count} review{p.call_count === 1 ? "" : "s"}
                      {p.escalation_count > 0 && ` · ${p.escalation_count} escalation`}
                      {p.calibrated_count > 0 && ` · ${p.calibrated_count} calibrated`}
                      {p.last_added_at && ` · last ${formatDate(p.last_added_at)}`}
                    </p>
                  </div>
                  <span className="text-[12px] text-ink-45 shrink-0">
                    {expanded === p.id ? "Hide" : "Show"}
                  </span>
                </button>

                {expanded === p.id && (
                  <ul className="border-t border-rule-soft divide-y divide-rule-soft">
                    {(contents[p.id] ?? []).map((c) => (
                      <li
                        key={c.call_id}
                        className="px-4 py-2.5 flex justify-between items-center gap-3"
                      >
                        <span className="text-[13.5px] min-w-0">
                          {c.call_title}
                          {c.is_high_risk && (
                            <span className="text-[11px] text-[#AC3A2A] ml-2">escalation</span>
                          )}
                        </span>
                        <span className="flex items-center gap-3 shrink-0">
                          <span className="font-mono text-[11px] text-ink-45">
                            {c.calibration_status === "submitted"
                              ? `calibrated · ${c.overall_score ?? "—"}%`
                              : "awaiting calibration"}
                          </span>
                          <button
                            onClick={() => onOpenCall(c.call_id)}
                            className="border border-rule rounded px-3 py-1 text-[12.5px] hover:bg-ground-2"
                          >
                            Open
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {uploadOpen && (
        <UploadDialog
          session={session}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => void load()}
        />
      )}
    </div>
  );
}

/** What this call is waiting on, in the reviewer's language. */
function stepLabel(t: RawWorklistItem): string {
  switch (t.next_step) {
    case "needs_audio":
      return "no audio yet";
    case "transcribing":
      return "transcribing…";
    case "transcription_failed":
      return "needs a transcript";
    case "needs_transcript":
      return "needs a transcript";
    case "in_progress":
      return `${t.segment_count} lines`;
    default:
      return `${t.segment_count} lines`;
  }
}

function Empty({
  title,
  body,
  onUpload,
}: {
  title: string;
  body: string;
  onUpload?: () => void;
}): JSX.Element {
  return (
    <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
      <h2 className="font-display text-2xl mb-2">{title}</h2>
      <p className="text-ink-70 max-w-md mx-auto">{body}</p>
      {onUpload && (
        <button
          onClick={onUpload}
          className="mt-4 bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium hover:opacity-85"
        >
          Upload a recording
        </button>
      )}
    </div>
  );
}
