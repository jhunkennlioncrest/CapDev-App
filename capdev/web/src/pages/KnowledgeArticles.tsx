import { useCallback, useEffect, useState } from "react";
import {
  addReference,
  addSection,
  getReferences,
  listCitable,
  REFERENCE_TYPES,
  removeReference,
  createArticle,
  getArticle,
  getArticleSections,
  listArticles,
  recordArticleView,
  removeSection,
  SECTION_KINDS,
  updateArticle,
  updateSection,
  type ArticleReference,
  type ArticleSection,
  type CitableAsset,
  type KnowledgeArticle,
  type ReferenceType,
} from "@/lib/knowledge";
import { formatDate } from "@/lib/format";
import type { Session } from "@/lib/types";

/**
 * Knowledge Articles — the organisation's canonical reference on a subject.
 *
 * Not an SOP. An SOP is one possible section among several, which is why
 * sections are typed: "Why Authors Resist Upsells" is knowledge worth keeping
 * and contains no procedure at all.
 */
export function KnowledgeArticles({
  session,
  openId,
  onOpen,
}: {
  session: Session;
  openId: string | null;
  onOpen: (id: string | null) => void;
}): JSX.Element {
  const [articles, setArticles] = useState<KnowledgeArticle[] | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setArticles(await listArticles());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(): Promise<void> {
    try {
      const id = await createArticle({
        orgId: session.person.org_id,
        personId: session.person.id,
        title,
      });
      setTitle("");
      setCreating(false);
      onOpen(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (openId) {
    return (
      <ArticleEditor
        id={openId}
        onBack={() => {
          onOpen(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <div className="flex justify-between items-start gap-4 flex-wrap mb-4">
        <p className="text-[13px] text-ink-70 max-w-xl">
          Everything the organisation knows about one subject. A procedure is one
          section among several &mdash; plenty of articles have none.
        </p>
        <button
          onClick={() => setCreating(true)}
          className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium hover:opacity-85"
        >
          New article
        </button>
      </div>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      {creating && (
        <div className="bg-card border border-rule-soft rounded px-4 py-3.5 mb-4 max-w-lg">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Why authors resist upsells"
            className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm mb-2.5"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void create()}
              disabled={!title.trim()}
              className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-40"
            >
              Create
            </button>
            <button
              onClick={() => setCreating(false)}
              className="border border-rule rounded px-3.5 py-1.5 text-[13px] hover:bg-ground-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {articles === null ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : articles.length === 0 ? (
        <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
          <h2 className="font-display text-2xl mb-2">No articles yet</h2>
          <p className="text-ink-70 max-w-md mx-auto">
            When a topic keeps coming up in calibration, write it down once here
            and point people at it.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {articles.map((a) => (
            <li
              key={a.id}
              className="bg-card border border-rule-soft rounded px-4 py-3.5 flex justify-between items-start gap-4 flex-wrap"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2.5 flex-wrap">
                  <button
                    onClick={() => onOpen(a.id)}
                    className="font-display text-lg text-left hover:underline underline-offset-2"
                  >
                    {a.title}
                  </button>
                  {a.has_sop && (
                    <span className="text-[10.5px] border border-rule text-ink-45 rounded-full px-2 py-0.5">
                      includes SOP
                    </span>
                  )}
                  {a.topic && (
                    <span className="text-[11px] text-ink-45">{a.topic}</span>
                  )}
                </div>
                {a.summary && (
                  <p className="text-[13.5px] text-ink-70 mt-0.5">{a.summary}</p>
                )}
                <p className="font-mono text-[11px] text-ink-45 mt-1">
                  {a.section_count} section{a.section_count === 1 ? "" : "s"} &middot;{" "}
                  {a.reference_count} reference{a.reference_count === 1 ? "" : "s"}
                  {a.view_count > 0 && ` · read ${a.view_count}×`}
                  {" · "}
                  {formatDate(a.updated_at)}
                </p>
              </div>
              <button
                onClick={() => onOpen(a.id)}
                className="border border-rule rounded px-3.5 py-1.5 text-[13px] hover:bg-ground-2 shrink-0"
              >
                Read
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ArticleEditor({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const [article, setArticle] = useState<KnowledgeArticle | null>(null);
  const [sections, setSections] = useState<ArticleSection[]>([]);
  const [references, setReferences] = useState<ArticleReference[]>([]);
  const [addingKind, setAddingKind] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const [a, s, r] = await Promise.all([
      getArticle(id),
      getArticleSections(id),
      getReferences(id),
    ]);
    setArticle(a);
    setSections(s);
    setReferences(r);
    if (a) void recordArticleView(id, a.view_count);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveArticle(patch: Partial<KnowledgeArticle>): Promise<void> {
    if (!article) return;
    setArticle({ ...article, ...patch });
    await updateArticle(id, patch);
    setSavedAt(new Date());
  }

  async function add(kind: ArticleSection["kind"]): Promise<void> {
    const spec = SECTION_KINDS.find((k) => k.value === kind);
    await addSection({
      articleId: id,
      kind,
      heading: spec?.label ?? "Section",
      sortOrder: sections.length + 1,
    });
    setAddingKind(false);
    await load();
  }

  if (!article) {
    return <p className="max-w-6xl mx-auto px-6 py-8 text-ink-45 text-sm">Loading&hellip;</p>;
  }

  const used = new Set(sections.map((s) => s.kind));

  return (
    <div className="max-w-3xl mx-auto px-6 pb-20">
      <button
        onClick={onBack}
        className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
      >
        &larr; Knowledge articles
      </button>

      <div className="flex justify-between items-baseline gap-4 flex-wrap mt-3">
        <input
          value={article.title}
          onChange={(e) => setArticle({ ...article, title: e.target.value })}
          onBlur={(e) => void saveArticle({ title: e.target.value })}
          className="font-display text-3xl bg-transparent border-0 border-b border-transparent hover:border-rule focus:border-ink focus:outline-none flex-1 min-w-0"
        />
        {savedAt && (
          <span className="text-[12px] text-ink-45">Saved {savedAt.toLocaleTimeString()}</span>
        )}
      </div>

      <input
        value={article.summary}
        onChange={(e) => setArticle({ ...article, summary: e.target.value })}
        onBlur={(e) => void saveArticle({ summary: e.target.value })}
        placeholder="One line on what this covers"
        className="w-full mt-2 mb-6 bg-transparent border-0 border-b border-transparent hover:border-rule focus:border-ink focus:outline-none text-[15px] text-ink-70 py-1"
      />

      {sections.length === 0 && (
        <p className="text-[13px] text-ink-45 mb-4">
          Empty so far. Add the sections this subject actually needs &mdash; not
          every article wants the same ones.
        </p>
      )}

      {sections.map((s) => (
        <SectionEditor
          key={s.id}
          section={s}
          onSave={(patch) => {
            void updateSection(s.id, patch).then(() => setSavedAt(new Date()));
          }}
          onRemove={() => {
            void removeSection(s.id).then(load);
          }}
        />
      ))}

      <ReferenceList
        articleId={id}
        references={references}
        onChanged={load}
      />

      <div className="mt-4">
        {addingKind ? (
          <div className="bg-card border border-rule-soft rounded px-4 py-3.5">
            <p className="text-[12px] font-semibold mb-2">What kind of section?</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {SECTION_KINDS.map((k) => (
                <button
                  key={k.value}
                  onClick={() => void add(k.value)}
                  className="text-left border border-rule rounded px-3 py-2 hover:bg-ground-2"
                >
                  <span className="text-[13.5px] font-medium">
                    {k.label}
                    {used.has(k.value) && k.value !== "free_text" && (
                      <span className="text-ink-45 font-normal"> · already added</span>
                    )}
                  </span>
                  <span className="block text-[12px] text-ink-45">{k.hint}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setAddingKind(false)}
              className="text-[12.5px] text-ink-45 underline underline-offset-2 mt-3"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingKind(true)}
            className="border border-rule rounded px-3.5 py-2 text-[13px] hover:bg-ground-2"
          >
            Add a section
          </button>
        )}
      </div>
    </div>
  );
}

function SectionEditor({
  section,
  onSave,
  onRemove,
}: {
  section: ArticleSection;
  onSave: (patch: Partial<ArticleSection>) => void;
  onRemove: () => void;
}): JSX.Element {
  const [heading, setHeading] = useState(section.heading);
  const [body, setBody] = useState(section.body);
  const spec = SECTION_KINDS.find((k) => k.value === section.kind);

  return (
    <section className="mb-6">
      <div className="flex justify-between items-baseline gap-3 border-b border-rule pb-1.5 mb-2">
        <input
          value={heading}
          onChange={(e) => setHeading(e.target.value)}
          onBlur={() => onSave({ heading })}
          className="font-display text-xl bg-transparent border-0 focus:outline-none flex-1 min-w-0"
        />
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 shrink-0">
          {spec?.label ?? section.kind}
        </span>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => onSave({ body })}
        rows={5}
        placeholder={spec?.hint}
        className="w-full border border-rule rounded px-3 py-2.5 bg-white text-[14px] leading-relaxed"
      />
      <button
        onClick={onRemove}
        className="text-[12px] text-ink-45 underline underline-offset-2 hover:text-ink mt-1.5"
      >
        Remove section
      </button>
    </section>
  );
}


/**
 * What this article points at.
 *
 * Citing rather than restating: a teaching moment referenced by three articles
 * is still one moment, so correcting it corrects all three. Grouped by type
 * because "Examples" and "Source evaluations" are different claims about why
 * something is here.
 */
function ReferenceList({
  articleId,
  references,
  onChanged,
}: {
  articleId: string;
  references: ArticleReference[];
  onChanged: () => Promise<void>;
}): JSX.Element {
  const [picking, setPicking] = useState<ReferenceType | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="mt-8 border-t border-rule pt-5">
      <h3 className="font-display text-xl mb-1">Referenced knowledge</h3>
      <p className="text-[13px] text-ink-70 mb-3">
        Point at what already exists rather than repeating it here.
      </p>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-2">{error}</p>}

      {REFERENCE_TYPES.map(({ value, plural }) => {
        const ofType = references.filter((r) => r.subject_type === value);
        if (ofType.length === 0) return null;
        return (
          <div key={value} className="mb-3">
            <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-1.5">
              {plural}
            </p>
            <ul className="space-y-1">
              {ofType.map((r) => (
                <li
                  key={r.id}
                  className="flex justify-between items-start gap-3 border-l-2 border-rule pl-2.5"
                >
                  <span className="text-[13.5px] min-w-0">
                    <span className="text-ink-45 mr-1">&rarr;</span>
                    {r.title}
                    {r.subtitle && (
                      <span className="text-[12px] text-ink-45 block ml-4">{r.subtitle}</span>
                    )}
                  </span>
                  <button
                    onClick={() => {
                      void removeReference(r.id).then(onChanged);
                    }}
                    className="text-[11.5px] text-ink-45 hover:text-[#AC3A2A] underline underline-offset-2 shrink-0"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {picking ? (
        <AssetPicker
          type={picking}
          alreadyCited={references
            .filter((r) => r.subject_type === picking)
            .map((r) => r.subject_id)}
          onPick={async (assetId) => {
            try {
              await addReference({
                articleId,
                subjectType: picking,
                subjectId: assetId,
                sortOrder: references.length + 1,
              });
              await onChanged();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
          onClose={() => setPicking(null)}
        />
      ) : (
        <div className="flex gap-2 flex-wrap mt-2">
          {REFERENCE_TYPES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setPicking(value)}
              className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2"
            >
              Cite a {label.toLowerCase()}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function AssetPicker({
  type,
  alreadyCited,
  onPick,
  onClose,
}: {
  type: ReferenceType;
  alreadyCited: string[];
  onPick: (id: string) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [assets, setAssets] = useState<CitableAsset[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void listCitable(type).then(setAssets);
  }, [type]);

  const spec = REFERENCE_TYPES.find((r) => r.value === type);
  const visible = (assets ?? []).filter((a) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      a.title.toLowerCase().includes(q) || (a.subtitle ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="border border-ink rounded bg-card px-4 py-3.5 mt-2">
      <div className="flex justify-between items-center gap-3 mb-2.5">
        <p className="text-[13px] font-semibold">Cite a {spec?.label.toLowerCase()}</p>
        <button
          onClick={onClose}
          className="text-[12.5px] text-ink-45 underline underline-offset-2 hover:text-ink"
        >
          Done
        </button>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        className="w-full border border-rule rounded px-2.5 py-1.5 bg-white text-[13.5px] mb-2"
      />

      {assets === null ? (
        <p className="text-[13px] text-ink-45">Loading&hellip;</p>
      ) : visible.length === 0 ? (
        <p className="text-[13px] text-ink-45">
          {assets.length === 0
            ? `No ${spec?.plural.toLowerCase()} yet.`
            : "Nothing matches that."}
        </p>
      ) : (
        <ul className="divide-y divide-rule-soft max-h-64 overflow-auto">
          {visible.map((a) => {
            const cited = alreadyCited.includes(a.id);
            return (
              <li key={a.id}>
                <button
                  disabled={cited}
                  onClick={() => void onPick(a.id)}
                  className="w-full text-left px-1 py-2 hover:bg-ground disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <span className="text-[13.5px]">{a.title}</span>
                  {cited && (
                    <span className="text-[11.5px] text-ink-45 ml-2">already cited</span>
                  )}
                  {a.subtitle && (
                    <span className="block text-[12px] text-ink-45">{a.subtitle}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
