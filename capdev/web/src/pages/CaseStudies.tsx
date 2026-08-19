import { useCallback, useEffect, useState } from "react";
import {
  archiveCaseStudy,
  caseStudySources,
  createCaseStudyFrom,
  getCaseStudy,
  listCaseStudies,
  updateCaseStudy,
  type CaseStudy,
} from "@/lib/knowledge";
import { listRepository, getRecordScores, type RepositoryRow } from "@/lib/repository";
import { formatDate } from "@/lib/format";
import type { Session } from "@/lib/types";

export function CaseStudies({
  session,
  openId,
  onOpen,
}: {
  session: Session;
  openId: string | null;
  onOpen: (id: string | null) => void;
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
          What a call taught the organisation, written up so somebody who
          wasn&rsquo;t there can learn from it.
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
            Start from one or more completed evaluations. The evidence is already
            there &mdash; your job is to say what it means.
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
                  {cs.source_count ?? 0} evaluation
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
 * Creating a case study starts from evidence, never a blank page.
 *
 * Pick the evaluations, and the draft arrives carrying what they already
 * contain — the calls, the scores, the criteria that failed. The trainer's
 * contribution is interpretation, which is the part only they can supply.
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
  const [evaluations, setEvaluations] = useState<RepositoryRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listRepository().then(setEvaluations);
  }, []);

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const chosen = evaluations.filter((e) => selected.includes(e.evaluation_id));

      // Pull the failed criteria out of the first evaluation so the draft opens
      // pointing at what actually went wrong.
      let failed: string[] = [];
      let whatHappened = "";
      if (chosen[0]) {
        const scores = await getRecordScores(chosen[0].evaluation_id);
        const misses = scores.filter((s) => s.final_value === "no");
        failed = misses.map((s) => s.criterion_id);
        whatHappened = misses
          .map((s) => `${s.code} — ${s.statement}${s.remark ? ` (${s.remark})` : ""}`)
          .join("\n");
      }

      const id = await createCaseStudyFrom({
        orgId: session.person.org_id,
        personId: session.person.id,
        evaluationIds: selected,
        title,
        prefill: {
          scenario: chosen
            .map(
              (e) =>
                `${e.call_title} — ${e.agent_name ?? "rep not set"}, scored ${e.overall_score ?? "—"}%`,
            )
            .join("\n"),
          what_happened: whatHappened,
          criterion_ids: failed,
        },
      });
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
        Choose the evaluations it draws on. More than one is fine &mdash; a
        pattern is often only visible across several calls.
      </p>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      <label className="block max-w-md mb-4">
        <span className="block text-[12px] font-semibold mb-1.5">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Common calibration variance"
          className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
        />
      </label>

      <p className="text-[12px] font-semibold mb-2">
        Evaluations
        <span className="font-normal text-ink-45"> — {selected.length} selected</span>
      </p>

      {evaluations.length === 0 ? (
        <p className="text-[13px] text-ink-45">
          No completed evaluations yet. Finish a calibration first.
        </p>
      ) : (
        <ul className="border border-rule-soft rounded bg-card divide-y divide-rule-soft max-h-80 overflow-auto mb-4">
          {evaluations.map((e) => (
            <li key={e.evaluation_id}>
              <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-ground">
                <input
                  type="checkbox"
                  checked={selected.includes(e.evaluation_id)}
                  onChange={(ev) =>
                    setSelected((s) =>
                      ev.target.checked
                        ? [...s, e.evaluation_id]
                        : s.filter((x) => x !== e.evaluation_id),
                    )
                  }
                />
                <span className="text-[13.5px] flex-1">
                  {e.call_title}
                  <span className="text-ink-45 ml-2">{e.agent_name}</span>
                </span>
                <span className="font-mono text-[11.5px] text-ink-45">
                  {e.overall_score === null ? "—" : `${e.overall_score}%`}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={() => void create()}
        disabled={!title.trim() || selected.length === 0 || busy}
        className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium disabled:opacity-40"
      >
        {busy ? "Preparing…" : "Start writing"}
      </button>
    </div>
  );
}

function CaseStudyEditor({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const [study, setStudy] = useState<CaseStudy | null>(null);
  const [sources, setSources] = useState<
    { evaluation_id: string; call_title: string; overall_score: number | null }[]
  >([]);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getCaseStudy(id), caseStudySources(id)]).then(([cs, src]) => {
      setStudy(cs);
      setSources(src);
    });
  }, [id]);

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

  if (!study) return <p className="max-w-6xl mx-auto px-6 py-8 text-ink-45 text-sm">Loading&hellip;</p>;

  return (
    <div className="max-w-3xl mx-auto px-6 pb-20">
      <button
        onClick={onBack}
        className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
      >
        &larr; Case studies
      </button>

      <div className="flex justify-between items-baseline gap-4 flex-wrap mt-3 mb-1">
        <input
          value={study.title}
          onChange={(e) => setStudy({ ...study, title: e.target.value })}
          onBlur={(e) => void save({ title: e.target.value })}
          className="font-display text-3xl bg-transparent border-0 border-b border-transparent hover:border-rule focus:border-ink focus:outline-none flex-1 min-w-0"
        />
        {savedAt && (
          <span className="text-[12px] text-ink-45">
            Saved {savedAt.toLocaleTimeString()}
          </span>
        )}
      </div>

      {sources.length > 0 && (
        <p className="text-[12px] text-ink-45 mb-5">
          Drawn from {sources.map((s) => `${s.call_title} (${s.overall_score ?? "—"}%)`).join(", ")}
        </p>
      )}

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      <Section
        label="In one line"
        hint="what someone sees in the library"
        value={study.summary}
        onSave={(v) => void save({ summary: v })}
        rows={2}
      />
      <Section
        label="The situation"
        hint="what was happening before the call"
        value={study.scenario}
        onSave={(v) => void save({ scenario: v })}
      />
      <Section
        label="What happened"
        hint="pre-filled from the evaluation — edit freely"
        value={study.what_happened}
        onSave={(v) => void save({ what_happened: v })}
        rows={6}
      />
      <Section
        label="Why it mattered"
        hint="the part only you can write"
        value={study.why_it_mattered}
        onSave={(v) => void save({ why_it_mattered: v })}
      />
      <Section
        label="What to do instead"
        value={study.recommended_approach}
        onSave={(v) => void save({ recommended_approach: v })}
      />
      <Section
        label="Questions for discussion"
        hint="one per line"
        value={study.learning_questions.join("\n")}
        onSave={(v) =>
          void save({
            learning_questions: v.split("\n").map((q) => q.trim()).filter(Boolean),
          })
        }
        rows={3}
      />

      <div className="border-t border-rule mt-6 pt-4">
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

function Section({
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
    <label className="block mb-5">
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
