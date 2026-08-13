import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRecordScores,
  getRepositoryRecord,
  getVersions,
  supersedeEvaluation,
  type RecordScore,
  type RepositoryRow,
  type VersionRow,
} from "@/lib/repository";
import { evidenceForEvaluation, listMomentsForCall, type Evidence, type Moment } from "@/lib/moments";
import { getScoreIds } from "@/lib/moments";
import { getTranscript, signedUrlFor, type StoredTranscript } from "@/lib/calls";
import { formatDate, formatDuration } from "@/lib/format";
import { CallTimeline } from "@/components/CallTimeline";
import { MOMENT_TYPES } from "@/lib/moments";
import type { Session } from "@/lib/types";

interface Props {
  callId: string;
  session: Session;
  onBack: () => void;
  onOpenCall: (id: string) => void;
}

/**
 * The permanent quality record. Read-only by design.
 *
 * Correcting anything here goes through supersede, which creates a successor
 * and retires the original rather than editing it — a score that informed a
 * coaching conversation must stay readable exactly as it was at the time.
 */
export function QualityRecord({ callId, session, onBack, onOpenCall }: Props): JSX.Element {
  const [record, setRecord] = useState<RepositoryRow | null>(null);
  const [scores, setScores] = useState<RecordScore[]>([]);
  const [evidence, setEvidence] = useState<Record<string, Evidence[]>>({});
  const [moments, setMoments] = useState<Moment[]>([]);
  const [transcript, setTranscript] = useState<StoredTranscript | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [correcting, setCorrecting] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const clipEndRef = useRef<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const rec = await getRepositoryRecord(callId);
      setRecord(rec);
      if (!rec) return;

      const [sc, ids, mo, tr, vs] = await Promise.all([
        getRecordScores(rec.evaluation_id),
        getScoreIds(rec.evaluation_id),
        listMomentsForCall(callId),
        getTranscript(callId),
        getVersions(callId),
      ]);
      setScores(sc);
      setMoments(mo);
      setTranscript(tr);
      setVersions(vs);
      setEvidence(await evidenceForEvaluation(Object.values(ids)));
      if (rec.storage_path) setAudioUrl(await signedUrlFor(rec.storage_path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [callId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Plays a bounded span and stops at its end — never the whole call. */
  function playClip(startMs: number | null, endMs: number | null): void {
    if (startMs === null || !audioRef.current) return;
    clipEndRef.current = endMs;
    audioRef.current.currentTime = startMs / 1000;
    void audioRef.current.play();
  }

  async function correct(): Promise<void> {
    if (!record) return;
    setCorrecting(true);
    try {
      await supersedeEvaluation(record.evaluation_id);
      onOpenCall(callId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCorrecting(false);
    }
  }

  if (loading) return <p className="max-w-5xl mx-auto px-6 py-10 text-ink-45 text-sm">Loading&hellip;</p>;
  if (!record) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-10">
        <button onClick={onBack} className="text-[13px] text-ink-45 underline">&larr; Repository</button>
        <p className="mt-4">No completed evaluation for that call.</p>
      </div>
    );
  }

  const canCorrect = session.permissions.includes("calibration.perform");
  const byScoreId = (criterionId: string): Evidence[] => {
    const sc = scores.find((s) => s.criterion_id === criterionId);
    return sc ? (evidence[sc.score_id] ?? []) : [];
  };

  const sections = [...new Set(scores.map((s) => s.section_title))];

  return (
    <div className="max-w-5xl mx-auto px-6 pb-20">
      <header className="pt-8 pb-4 border-b border-rule">
        <button onClick={onBack} className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2">
          &larr; Quality repository
        </button>
        <div className="flex justify-between items-start gap-4 flex-wrap mt-3">
          <div>
            <h1 className="font-display text-3xl">{record.call_title}</h1>
            <p className="text-[12px] text-ink-45 mt-1">
              {record.agent_name || "Rep not set"} &middot; reviewed by{" "}
              {record.reviewer_name ?? "—"} &middot; calibrated by {record.trainer_name ?? "—"}
              {record.submitted_at && ` · ${formatDate(record.submitted_at)}`}
              {record.rubric_version && ` · rubric v${record.rubric_version}`}
            </p>
          </div>
          <div className="text-right">
            <span className="font-display text-4xl block leading-none">
              {record.overall_score === null ? "—" : `${record.overall_score}%`}
            </span>
            <span className="text-[11.5px] text-ink-45">
              {record.reward_tier === "premium"
                ? "Premium reward"
                : record.reward_tier === "kudos"
                  ? "Kudos"
                  : "no reward tier"}
            </span>
          </div>
        </div>
      </header>

      <div className="pt-3 pb-1 border-b border-rule-soft">
        <CallTimeline status={record.workflow_status} />
      </div>

      {error && <p className="mt-4 text-[13px] text-[#AC3A2A]">{error}</p>}

      {record.under_revision && (
        <p className="mt-4 text-[13px] text-[#96690A]">
          A correction is in progress. This shows the last submitted version until
          the new one is submitted.
        </p>
      )}

      {audioUrl && (
        <div className="sticky top-0 z-10 bg-ground pt-4 pb-3">
          <audio
            ref={audioRef}
            controls
            src={audioUrl}
            className="w-full"
            onTimeUpdate={(e) => {
              const ms = e.currentTarget.currentTime * 1000;
              if (clipEndRef.current !== null && ms >= clipEndRef.current) {
                e.currentTarget.pause();
                clipEndRef.current = null;
              }
            }}
          />
        </div>
      )}

      {record.summary_note && (
        <section className="mt-5">
          <h2 className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-1.5">
            Summary
          </h2>
          <p className="text-[14px] text-ink-70">{record.summary_note}</p>
        </section>
      )}

      {/* Scoresheet, raw beside final */}
      {sections.map((title) => (
        <section key={title} className="mt-7">
          <h2 className="font-display text-xl border-b border-rule pb-2 mb-3">{title}</h2>
          {scores
            .filter((s) => s.section_title === title)
            .map((s) => {
              const ev = byScoreId(s.criterion_id);
              return (
                <div
                  key={s.score_id}
                  className={`bg-card border rounded px-4 py-3 mb-2 ${
                    s.changed ? "border-[#96690A]" : "border-rule-soft"
                  }`}
                >
                  <div className="flex justify-between items-start gap-4 flex-wrap">
                    <p className="text-[14px] min-w-0 flex-1">
                      <span className="font-mono text-[11px] text-ink-45 mr-2">{s.code}</span>
                      {s.label && s.code.startsWith("NN") && (
                        <span className="font-semibold">{s.label}. </span>
                      )}
                      {s.statement}
                    </p>
                    <div className="flex items-center gap-2 shrink-0 font-mono text-[12px]">
                      {s.changed && s.raw_value && (
                        <>
                          <span className="text-ink-45 line-through">
                            {s.raw_value.toUpperCase()}
                          </span>
                          <span className="text-ink-45">→</span>
                        </>
                      )}
                      <span
                        className={`px-2 py-1 rounded text-white ${
                          s.final_value === "yes"
                            ? "bg-[#1F7A4D]"
                            : s.final_value === "no"
                              ? "bg-[#AC3A2A]"
                              : "bg-ink"
                        }`}
                      >
                        {s.final_value === "na" ? "N/A" : (s.final_value ?? "—").toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {s.changed && (
                    <p className="text-[12px] text-[#96690A] mt-1.5">
                      Changed at calibration from {s.raw_value?.toUpperCase()}.
                    </p>
                  )}
                  {s.remark && <p className="text-[13px] text-ink-70 mt-1.5">{s.remark}</p>}

                  {ev.map((x) => (
                    <div key={x.id} className="mt-2 border-l-2 border-ink pl-3">
                      <button
                        onClick={() => playClip(x.start_ms, x.end_ms)}
                        disabled={x.start_ms === null || !audioUrl}
                        className="font-mono text-[11px] text-ink-45 underline underline-offset-2 hover:text-ink disabled:no-underline"
                      >
                        {x.start_ms !== null && x.end_ms !== null
                          ? `▶ ${formatDuration(x.start_ms)}–${formatDuration(x.end_ms)}`
                          : "cited"}
                      </button>
                      <p className="text-[12.5px] text-ink-70 whitespace-pre-line">{x.excerpt}</p>
                      {x.note && <p className="text-[12.5px] mt-0.5">{x.note}</p>}
                    </div>
                  ))}
                </div>
              );
            })}
        </section>
      ))}

      {/* Teaching moments */}
      {moments.length > 0 && (
        <section className="mt-7">
          <h2 className="font-display text-xl border-b border-rule pb-2 mb-3">
            Teaching moments
            <span className="font-sans text-[12px] text-ink-45 ml-2.5">{moments.length}</span>
          </h2>
          {moments.map((m) => (
            <div key={m.id} className="bg-card border border-rule-soft rounded px-4 py-3 mb-2">
              <div className="flex justify-between items-start gap-3 flex-wrap">
                <div className="min-w-0">
                  <span className="font-display text-base">{m.title}</span>
                  <span className="text-[11px] text-ink-45 ml-2">
                    {MOMENT_TYPES.find((t) => t.value === m.moment_type)?.label ?? m.moment_type}
                  </span>
                </div>
                <button
                  onClick={() => playClip(m.start_ms, m.end_ms)}
                  disabled={!audioUrl}
                  className="font-mono text-[11.5px] text-ink-45 underline underline-offset-2 hover:text-ink disabled:no-underline shrink-0"
                >
                  ▶ {formatDuration(m.start_ms)}–{formatDuration(m.end_ms)}
                </button>
              </div>
              {m.coaching_note && (
                <p className="text-[13px] text-ink-70 mt-1.5">{m.coaching_note}</p>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Transcript, collapsed by default */}
      {transcript && (
        <section className="mt-7">
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="w-full flex justify-between items-baseline border-b border-rule pb-2 mb-3"
          >
            <h2 className="font-display text-xl">
              Transcript
              <span className="font-sans text-[12px] text-ink-45 ml-2.5">
                {transcript.segment_count} lines
              </span>
            </h2>
            <span className="text-[12px] text-ink-45">{showTranscript ? "Hide" : "Show"}</span>
          </button>
          {showTranscript && (
            <ul className="bg-card border border-rule-soft rounded divide-y divide-rule-soft max-h-[50vh] overflow-auto">
              {transcript.segments.map((seg) => (
                <li
                  key={seg.i}
                  onClick={() => playClip(seg.start_ms, null)}
                  className="px-4 py-2 flex gap-3 items-baseline cursor-pointer hover:bg-ground"
                >
                  <span className="font-mono text-[11px] text-ink-45 w-14 shrink-0 tabular-nums">
                    {seg.start_ms === null ? "—" : formatDuration(seg.start_ms)}
                  </span>
                  <span className="text-[13.5px]">
                    {seg.speaker && <span className="font-semibold mr-1">{seg.speaker}:</span>}
                    {seg.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Status and history */}
      <section className="mt-7 border-t border-rule pt-5">
        <div className="grid sm:grid-cols-3 gap-4 text-[13px]">
          <div>
            <span className="block font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-1">
              Case study
            </span>
            {record.case_study_status === "not_created"
              ? "Not created"
              : record.case_study_status === "draft"
                ? "Draft"
                : "Published"}
          </div>
          <div>
            <span className="block font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-1">
              Knowledge
            </span>
            {record.published_at ? (
              <>
                Published {formatDate(record.published_at)}
                {record.published_url && (
                  <>
                    {" · "}
                    <a
                      href={record.published_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      open
                    </a>
                  </>
                )}
              </>
            ) : (
              "Not published"
            )}
          </div>
          <div>
            <span className="block font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-1">
              Versions
            </span>
            <button
              onClick={() => setShowVersions((v) => !v)}
              className="underline underline-offset-2 hover:text-ink"
            >
              {versions.length} version{versions.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>

        {showVersions && (
          <ul className="mt-4 border border-rule-soft rounded divide-y divide-rule-soft bg-card">
            {versions.map((v, i) => (
              <li key={v.id} className="px-4 py-2.5 flex justify-between items-baseline gap-3">
                <span className="text-[13px]">
                  <span className="font-mono text-[11px] text-ink-45 mr-2">
                    v{versions.length - i}
                  </span>
                  {v.evaluator_name ?? "—"}
                  {v.submitted_at && ` · ${formatDate(v.submitted_at)}`}
                  {v.status !== "submitted" && (
                    <span className="text-ink-45"> · {v.status}</span>
                  )}
                </span>
                <span className="font-mono text-[12px] text-ink-70">
                  {v.overall_score === null ? "—" : `${v.overall_score}%`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {canCorrect && !record.under_revision && (
          <div className="mt-5">
            <button
              onClick={() => void correct()}
              disabled={correcting}
              className="border border-rule rounded px-3.5 py-2 text-[13px] hover:bg-ground-2 disabled:opacity-40"
            >
              {correcting ? "Creating…" : "Correct this evaluation"}
            </button>
            <p className="text-[12px] text-ink-45 mt-1.5">
              Creates a new version. This one is kept and stays readable.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
