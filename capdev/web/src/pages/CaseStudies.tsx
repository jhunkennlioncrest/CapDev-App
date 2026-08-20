import { useCallback, useEffect, useState } from "react";
import {
  archiveCaseStudy,
  caseStudySources,
  createCaseStudyFrom,
  draftNarrative,
  getCaseStudy,
  getCaseStudyEvidence,
  getCaseStudyMoments,
  listCaseStudies,
  listCitable,
  linkMoment,
  listSourceOptions,
  seedFromSources,
  unlinkEvidence,
  unlinkMoment,
  updateCaseStudy,
  type CaseStudy,
  type CaseStudyEvidence,
  type CaseStudyMoment,
  type SourceOption,
} from "@/lib/knowledge";
import { getRecordScores } from "@/lib/repository";
import { formatDate } from "@/lib/format";
import { resolveSpeakersInText } from "@/lib/speakers";
import { useSpeakers } from "@/lib/useSpeakers";
import type { Session } from "@/lib/types";

export function CaseStudies({
  session,
  openId,
  onOpen,
  onPlayClip,
}: {
  session: Session;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onPlayClip?: (startMs: number, endMs: number) => void;
}): JSX.Element {
  const [studies, setStudies] = useState<CaseStudy[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStudies(await listCaseStudies());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (openId) {
    return (
      <CaseStudyEditor
        id={openId}
        onPlayClip={onPlayClip}
        onBack={() => {
          onOpen(null);
          void load();
        }}
      />
    );
  }

  if (creating) {
    return (
      <NewCaseStudy
        session={session}
        onCancel={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          onOpen(id);
        }}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <div className="flex justify-between items-start gap-4 flex-wrap mb-4">
        <p className="text-[13px] text-ink-70 max-w-xl">
          A completed evaluation says what happened. A case study says what it
          taught us.
        </p>
        <button
          onClick={() => setCreating(true)}
          className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium hover:opacity-85"
        >
          Write a case study
        </button>
      </div>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      {studies === null ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : studies.length === 0 ? (
        <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
          <h2 className="font-display text-2xl mb-2">No case studies yet</h2>
          <p className="text-ink-70 max-w-md mx-auto">
            Start from a completed evaluation. The evidence and the moments are
            already there &mdash; your part is what it means.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {studies.map((cs) => (
            <li
              key={cs.id}
              className="bg-card border border-rule-soft rounded px-4 py-3.5 flex justify-between items-start gap-4 flex-wrap"
            >
              <div className="min-w-0 flex-1">
                <button
                  onClick={() => onOpen(cs.id)}
                  className="font-display text-lg text-left hover:underline underline-offset-2"
                >
                  {cs.title}
                </button>
                {cs.summary && (
                  <p className="text-[13.5px] text-ink-70 mt-0.5">{cs.summary}</p>
                )}
                <p className="text-[12px] text-ink-45 mt-1">
                  {cs.source_count ?? 0} source evaluation
                  {(cs.source_count ?? 0) === 1 ? "" : "s"}
                  {cs.agent_names && ` · ${cs.agent_names}`}
                  {cs.author_name && ` · ${cs.author_name}`}
                  {" · "}
                  {formatDate(cs.updated_at)}
                </p>
              </div>
              <button
                onClick={() => onOpen(cs.id)}
                className="border border-rule rounded px-3.5 py-1.5 text-[13px] hover:bg-ground-2 shrink-0"
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Choosing the source.
 *
 * Shows what each evaluation already offers — evidence, moments, what failed —
 * so the trainer can see there is material before committing. Score is listed
 * without emphasis: a 62% call often makes the better lesson, and the list
 * should not imply otherwise.
 */
function NewCaseStudy({
  session,
  onCancel,
  onCreated,
}: {
  session: Session;
  onCancel: () => void;
  onCreated: (id: string) => void;
}): JSX.Element {
  const [options, setOptions] = useState<SourceOption[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A failed load must not look like an empty list. Before, a rejected
    // promise left this stuck on "Loading…", which reads as "the evaluation
    // is no longer available" — the opposite of what happened.
    void listSourceOptions()
      .then(setOptions)
      .catch((e: unknown) => {
        setOptions([]);
        setError(
          e instanceof Error
            ? `Could not load completed evaluations: ${e.message}`
            : String(e),
        );
      });
  }, []);

  const chosen = (options ?? []).filter((o) => selected.includes(o.evaluation_id));
  const totalEvidence = chosen.reduce((n, o) => n + o.evidence_count, 0);
  const totalMoments = chosen.reduce((n, o) => n + o.moment_count, 0);

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Read what calibration concluded, so the draft opens with the substance
      // rather than a blank page.
      let failures: { code: string; statement: string; remark: string }[] = [];
      let criterionIds: string[] = [];
      if (chosen[0]) {
        const scores = await getRecordScores(chosen[0].evaluation_id);
        const missed = scores.filter((s) => s.final_value === "no");
        failures = missed.map((s) => ({
          code: s.code,
          statement: s.statement,
          remark: s.remark ?? "",
        }));
        criterionIds = missed.map((s) => s.criterion_id);
      }

      const draft = draftNarrative(chosen, failures);

      const id = await createCaseStudyFrom({
        orgId: session.person.org_id,
        personId: session.person.id,
        evaluationIds: selected,
        title: title.trim() || draft.title || "Untitled case study",
        prefill: {
          scenario: draft.scenario,
          what_happened: draft.whatHappened,
          criterion_ids: criterionIds,
        },
      });

      // Links the evidence and moments the sources already hold.
      await seedFromSources(id);
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <button
        onClick={onCancel}
        className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
      >
        &larr; Case studies
      </button>

      <h2 className="font-display text-2xl mt-3 mb-1">Write a case study</h2>
      <p className="text-[13px] text-ink-70 mb-5 max-w-xl">
        Choose what it comes from. More than one is fine &mdash; a pattern is
        often only visible across several calls.
      </p>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      {options === null ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : options.length === 0 ? (
        <p className="text-[13px] text-ink-45">
          No completed evaluations yet. Finish a calibration first.
        </p>
      ) : (
        <>
          <p className="text-[12px] text-ink-45 mb-2">
            An evaluation can be used by as many case studies as it has lessons
            to teach.
          </p>
          <ul className="border border-rule-soft rounded bg-card divide-y divide-rule-soft max-h-96 overflow-auto mb-4">
            {options.map((o) => {
              const on = selected.includes(o.evaluation_id);
              return (
                <li key={o.evaluation_id}>
                  <label
                    className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-ground ${
                      on ? "bg-ground" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setSelected((s) =>
                          e.target.checked
                            ? [...s, o.evaluation_id]
                            : s.filter((x) => x !== o.evaluation_id),
                        )
                      }
                      className="mt-1"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="text-[14px]">
                        {o.call_title}
                        {o.agent_name && (
                          <span className="text-ink-45 ml-2">{o.agent_name}</span>
                        )}
                      </span>
                      <span className="block text-[12px] text-ink-45 mt-0.5">
                        {o.overall_score === null ? "no score" : `${o.overall_score}%`}
                        {o.failed_criteria > 0 &&
                          ` · ${o.failed_criteria} criteri${o.failed_criteria === 1 ? "on" : "a"} not met`}
                        {o.reviewer_name && ` · reviewed by ${o.reviewer_name}`}
                        {o.under_revision && (
                          <span className="text-[#96690A]"> · being revised</span>
                        )}
                        {o.used_in_case_studies > 0 &&
                          ` · already used by ${o.used_in_case_studies} case stud${
                            o.used_in_case_studies === 1 ? "y" : "ies"
                          }`}
                      </span>
                      <span className="block text-[11.5px] text-ink-45 mt-1">
                        {o.evidence_count > 0 && (
                          <span className="mr-3">
                            &#10003; {o.evidence_count} piece
                            {o.evidence_count === 1 ? "" : "s"} of evidence
                          </span>
                        )}
                        {o.moment_count > 0 && (
                          <span>
                            &#10003; {o.moment_count} teaching moment
                            {o.moment_count === 1 ? "" : "s"}
                          </span>
                        )}
                        {o.evidence_count === 0 && o.moment_count === 0 && (
                          <span className="text-ink-45">no evidence or moments yet</span>
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {selected.length > 0 && (
            <div className="border border-rule rounded bg-ground px-4 py-3 mb-4">
              <p className="text-[13px]">
                Carrying forward{" "}
                <span className="font-semibold">{totalEvidence}</span> piece
                {totalEvidence === 1 ? "" : "s"} of evidence and{" "}
                <span className="font-semibold">{totalMoments}</span> teaching
                moment{totalMoments === 1 ? "" : "s"}. You can drop anything that
                doesn&rsquo;t serve the lesson.
              </p>
            </div>
          )}

          <label className="block max-w-md mb-4">
            <span className="block text-[12px] font-semibold mb-1.5">
              Title
              <span className="font-normal text-ink-45"> — leave blank to suggest one</span>
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The rep who missed the objection"
              className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
            />
          </label>

          <button
            onClick={() => void create()}
            disabled={selected.length === 0 || busy}
            className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {busy ? "Preparing…" : "Create case study"}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The case study editor.
 *
 * Two visually distinct zones. What the evaluation already established is
 * marked as such and arrives written; what only the trainer can supply is
 * marked as interpretation and arrives empty. The distinction is the whole
 * point — one is a record, the other is a lesson.
 */
function CaseStudyEditor({
  id,
  onBack,
  onPlayClip,
}: {
  id: string;
  onBack: () => void;
  onPlayClip?: (startMs: number, endMs: number) => void;
}): JSX.Element {
  const [study, setStudy] = useState<CaseStudy | null>(null);
  const [sources, setSources] = useState<
    { evaluation_id: string; call_title: string; overall_score: number | null }[]
  >([]);
  const [evidence, setEvidence] = useState<CaseStudyEvidence[]>([]);
  const [moments, setMoments] = useState<CaseStudyMoment[]>([]);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const [cs, src, ev, mo] = await Promise.all([
      getCaseStudy(id),
      caseStudySources(id),
      getCaseStudyEvidence(id),
      getCaseStudyMoments(id),
    ]);
    setStudy(cs);
    setSources(src);
    setEvidence(ev);
    setMoments(mo);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const speakers = useSpeakers(evidence[0]?.call_id ?? moments[0]?.call_id ?? null);

  async function save(patch: Partial<CaseStudy>): Promise<void> {
    if (!study) return;
    setStudy({ ...study, ...patch });
    try {
      await updateCaseStudy(id, patch);
      setSavedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!study) {
    return <p className="max-w-6xl mx-auto px-6 py-8 text-ink-45 text-sm">Loading&hellip;</p>;
  }

  return (
    <div className="max-w-3xl mx-auto px-6 pb-20">
      <button
        onClick={onBack}
        className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
      >
        &larr; Case studies
      </button>

      <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mt-3">
        Case study
      </p>
      <div className="flex justify-between items-baseline gap-4 flex-wrap">
        <input
          value={study.title}
          onChange={(e) => setStudy({ ...study, title: e.target.value })}
          onBlur={(e) => void save({ title: e.target.value })}
          className="font-display text-3xl bg-transparent border-0 border-b border-transparent hover:border-rule focus:border-ink focus:outline-none flex-1 min-w-0"
        />
        {savedAt && (
          <span className="text-[12px] text-ink-45">Saved {savedAt.toLocaleTimeString()}</span>
        )}
      </div>

      {sources.length > 0 && (
        <p className="text-[12.5px] text-ink-45 mt-1">
          Based on{" "}
          {sources
            .map((s) => `${s.call_title}${s.overall_score !== null ? ` · ${s.overall_score}%` : ""}`)
            .join(" · ")}
        </p>
      )}

      <input
        value={study.summary}
        onChange={(e) => setStudy({ ...study, summary: e.target.value })}
        onBlur={(e) => void save({ summary: e.target.value })}
        placeholder="One line — what someone sees when browsing the Library"
        className="w-full mt-3 mb-6 bg-transparent border-0 border-b border-transparent hover:border-rule focus:border-ink focus:outline-none text-[15px] text-ink-70 py-1"
      />

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      <Zone label="From the completed evaluation" tone="supplied">
        <Field
          label="The situation"
          value={study.scenario}
          onSave={(v) => void save({ scenario: v })}
        />
        <Field
          label="What happened"
          value={study.what_happened}
          onSave={(v) => void save({ what_happened: v })}
          rows={6}
        />
      </Zone>

      <Zone label="Your interpretation" tone="authored">
        <Field
          label="Why it mattered"
          hint="to the rep, the author, or the business"
          value={study.why_it_mattered}
          onSave={(v) => void save({ why_it_mattered: v })}
        />
        <Field
          label="What to do instead"
          hint="what should someone do differently next time"
          value={study.recommended_approach}
          onSave={(v) => void save({ recommended_approach: v })}
        />
      </Zone>

      {/* Evidence is referenced, so each clip keeps the exact boundaries it was
          cited with. Removing one here leaves the evaluation untouched. */}
      <section className="mt-7">
        <SectionHead label="Evidence" count={evidence.length} />
        {evidence.length === 0 ? (
          <p className="text-[13px] text-ink-45">
            Nothing cited yet. Evidence from the source evaluation appears here.
          </p>
        ) : (
          <ul className="space-y-2">
            {evidence.map((ev) => (
              <li key={ev.link_id} className="border-l-2 border-rule pl-3">
                <div className="flex items-baseline gap-2.5 flex-wrap">
                  {ev.start_ms !== null && onPlayClip ? (
                    <button
                      onClick={() =>
                        onPlayClip(ev.start_ms ?? 0, ev.end_ms ?? (ev.start_ms ?? 0) + 15000)
                      }
                      className="font-mono text-[11.5px] text-accent hover:underline underline-offset-2"
                    >
                      &#9654; {clock(ev.start_ms)}
                      {ev.end_ms !== null && `–${clock(ev.end_ms)}`}
                    </button>
                  ) : (
                    <span className="font-mono text-[11.5px] text-ink-45">
                      {clock(ev.start_ms)}
                    </span>
                  )}
                  {ev.criterion_code && (
                    <span className="font-mono text-[10.5px] text-ink-45">
                      {ev.criterion_code}
                    </span>
                  )}
                  {ev.added_here && (
                    <span className="text-[10.5px] text-ink-45">added here</span>
                  )}
                  <button
                    onClick={() => {
                      void unlinkEvidence(ev.link_id).then(load);
                    }}
                    className="text-[11px] text-ink-45 hover:text-[#AC3A2A] underline underline-offset-2"
                  >
                    remove
                  </button>
                </div>
                {ev.excerpt && (
                  <p className="text-[12.5px] text-ink-70 leading-relaxed whitespace-pre-line">
                    &ldquo;{resolveSpeakersInText(ev.excerpt, speakers)}&rdquo;
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-7">
        <SectionHead label="Teaching moments" count={moments.length} />
        <MomentPicker
          caseStudyId={id}
          linked={moments}
          onChanged={load}
          onPlayClip={onPlayClip}
          onError={setError}
        />
      </section>

      <section className="mt-7">
        <SectionHead label="Discussion questions" count={study.learning_questions.length} />
        <Questions
          questions={study.learning_questions}
          onSave={(qs) => void save({ learning_questions: qs })}
        />
      </section>

      <div className="border-t border-rule mt-8 pt-4">
        <button
          onClick={() => {
            void archiveCaseStudy(id).then(onBack);
          }}
          className="text-[12.5px] text-ink-45 underline underline-offset-2 hover:text-ink"
        >
          Archive this case study
        </button>
      </div>
    </div>
  );
}

function clock(ms: number | null): string {
  if (ms === null) return "—";
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** Marks whether the content below was supplied or must be authored. */
function Zone({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "supplied" | "authored";
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section
      className={`mb-6 rounded px-4 py-3.5 ${
        tone === "supplied"
          ? "bg-ground/50 border border-rule-soft"
          : "bg-card border-l-2 border-accent border-y border-r border-rule-soft"
      }`}
    >
      <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-3">
        {label}
      </p>
      {children}
    </section>
  );
}

function SectionHead({ label, count }: { label: string; count: number }): JSX.Element {
  return (
    <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 border-b border-rule pb-1.5 mb-2.5">
      {label}
      {count > 0 && <span className="ml-2">{count}</span>}
    </p>
  );
}

function Field({
  label,
  hint,
  value,
  onSave,
  rows = 4,
}: {
  label: string;
  hint?: string;
  value: string;
  onSave: (v: string) => void;
  rows?: number;
}): JSX.Element {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <label className="block mb-4 last:mb-0">
      <span className="block text-[12px] font-semibold mb-1.5">
        {label}
        {hint && <span className="font-normal text-ink-45"> — {hint}</span>}
      </span>
      <textarea
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => onSave(local)}
        rows={rows}
        className="w-full border border-rule rounded px-3 py-2.5 bg-white text-[14px] leading-relaxed"
      />
    </label>
  );
}

function Questions({
  questions,
  onSave,
}: {
  questions: string[];
  onSave: (qs: string[]) => void;
}): JSX.Element {
  const [adding, setAdding] = useState("");

  return (
    <div>
      {questions.length > 0 && (
        <ul className="space-y-1.5 mb-2.5">
          {questions.map((q, i) => (
            <li key={`${q}-${i}`} className="flex justify-between items-start gap-3">
              <span className="text-[13.5px]">
                <span className="text-ink-45 mr-1.5">{i + 1}.</span>
                {q}
              </span>
              <button
                onClick={() => onSave(questions.filter((_, k) => k !== i))}
                className="text-[11px] text-ink-45 hover:text-[#AC3A2A] underline underline-offset-2 shrink-0"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && adding.trim()) {
              onSave([...questions, adding.trim()]);
              setAdding("");
            }
          }}
          placeholder="What would you have done differently?"
          className="flex-1 border border-rule rounded px-2.5 py-1.5 bg-white text-[13.5px]"
        />
        <button
          onClick={() => {
            if (adding.trim()) {
              onSave([...questions, adding.trim()]);
              setAdding("");
            }
          }}
          disabled={!adding.trim()}
          className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function MomentPicker({
  caseStudyId,
  linked,
  onChanged,
  onPlayClip,
  onError,
}: {
  caseStudyId: string;
  linked: CaseStudyMoment[];
  onChanged: () => Promise<void>;
  onPlayClip?: (startMs: number, endMs: number) => void;
  onError: (m: string) => void;
}): JSX.Element {
  const [picking, setPicking] = useState(false);
  const [available, setAvailable] = useState<{ id: string; title: string; subtitle: string }[]>([]);

  useEffect(() => {
    if (picking) void listCitable("moment").then(setAvailable);
  }, [picking]);

  const linkedIds = new Set(linked.map((m) => m.moment_id));

  return (
    <div>
      {linked.length === 0 ? (
        <p className="text-[13px] text-ink-45 mb-2">
          None attached. A case study doesn&rsquo;t need one.
        </p>
      ) : (
        <ul className="space-y-1.5 mb-2.5">
          {linked.map((m) => (
            <li key={m.link_id} className="flex justify-between items-start gap-3">
              <span className="text-[13.5px] min-w-0">
                <span className="text-ink-45 mr-1.5">&bull;</span>
                {m.title}
                <span className="text-[11.5px] text-ink-45 ml-2">{m.moment_type}</span>
                {m.start_ms !== null && onPlayClip && (
                  <button
                    onClick={() =>
                      onPlayClip(m.start_ms ?? 0, m.end_ms ?? (m.start_ms ?? 0) + 15000)
                    }
                    className="font-mono text-[11px] text-accent hover:underline underline-offset-2 ml-2"
                  >
                    &#9654; {clock(m.start_ms)}
                  </button>
                )}
              </span>
              <button
                onClick={() => {
                  void unlinkMoment(m.link_id).then(onChanged);
                }}
                className="text-[11px] text-ink-45 hover:text-[#AC3A2A] underline underline-offset-2 shrink-0"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {picking ? (
        <div className="border border-ink rounded bg-card px-3.5 py-3">
          <div className="flex justify-between items-center mb-2">
            <p className="text-[13px] font-semibold">Add a teaching moment</p>
            <button
              onClick={() => setPicking(false)}
              className="text-[12.5px] text-ink-45 underline underline-offset-2"
            >
              Done
            </button>
          </div>
          {available.length === 0 ? (
            <p className="text-[13px] text-ink-45">No teaching moments yet.</p>
          ) : (
            <ul className="divide-y divide-rule-soft max-h-56 overflow-auto">
              {available.map((a) => (
                <li key={a.id}>
                  <button
                    disabled={linkedIds.has(a.id)}
                    onClick={() => {
                      void linkMoment({
                        caseStudyId,
                        momentId: a.id,
                        sortOrder: linked.length + 1,
                      })
                        .then(onChanged)
                        .catch((e) => onError(e instanceof Error ? e.message : String(e)));
                    }}
                    className="w-full text-left px-1 py-2 hover:bg-ground disabled:opacity-40"
                  >
                    <span className="text-[13.5px]">{a.title}</span>
                    {linkedIds.has(a.id) && (
                      <span className="text-[11px] text-ink-45 ml-2">already added</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button
          onClick={() => setPicking(true)}
          className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2"
        >
          Add a teaching moment
        </button>
      )}
    </div>
  );
}
