import { useCallback, useEffect, useState } from "react";
import { listCaseStudies, listArticles, type CaseStudy, type KnowledgeArticle } from "@/lib/knowledge";
import { listPlaylists, type PlaylistSummary } from "@/lib/playlists";
import { listRepository, type RepositoryRow } from "@/lib/repository";
import { supabase } from "@/lib/supabase";
import { formatDate, formatDuration } from "@/lib/format";
import { MOMENT_TYPES, type Moment } from "@/lib/moments";

interface Props {
  onOpenTab: (tab: "moments" | "playlists" | "casestudies" | "knowledge" | "evaluations") => void;
  onOpenCall: (id: string) => void;
  onOpenRecord: (id: string) => void;
  onOpenCaseStudy: (id: string) => void;
  onOpenArticle: (id: string) => void;
  onOpenPlaylist: (id: string) => void;
}

/**
 * The Library front page.
 *
 * Deliberately not five folders. A knowledge base people browse gets used; a
 * file system people navigate gets forgotten. This shows what is new, what is
 * being read, and what someone else thought was worth keeping — the questions
 * people actually arrive with.
 */
export function LibraryHome({
  onOpenTab,
  onOpenCall,
  onOpenRecord,
  onOpenCaseStudy,
  onOpenArticle,
  onOpenPlaylist,
}: Props): JSX.Element {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [studies, setStudies] = useState<CaseStudy[]>([]);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [evaluations, setEvaluations] = useState<RepositoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    const [m, p, cs, a, r] = await Promise.all([
      supabase
        .from("v_moment_list")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(4),
      listPlaylists("learning"),
      listCaseStudies(),
      listArticles(),
      listRepository(),
    ]);
    setMoments((m.data ?? []) as Moment[]);
    setPlaylists(p);
    setStudies(cs);
    setArticles(a);
    setEvaluations(r.slice(0, 4));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const featured = playlists[0];
  const isEmpty =
    moments.length === 0 && studies.length === 0 && articles.length === 0 && playlists.length === 0;

  if (loading) {
    return <p className="max-w-6xl mx-auto px-6 py-10 text-ink-45 text-sm">Loading&hellip;</p>;
  }

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      {isEmpty ? (
        <div className="border border-dashed border-rule rounded bg-card px-8 py-14 text-center mt-2">
          <h2 className="font-display text-2xl mb-2">The library is empty</h2>
          <p className="text-ink-70 max-w-md mx-auto">
            It fills as calibrations finish. Clip a teaching moment while you
            calibrate, or write a case study from a completed evaluation.
          </p>
        </div>
      ) : (
        <>
          {featured && (
            <section className="mt-2">
              <SectionHead
                title="Start here"
                action="All playlists"
                onAction={() => onOpenTab("playlists")}
              />
              <button
                onClick={() => onOpenPlaylist(featured.id)}
                className="w-full text-left bg-card border border-ink rounded px-6 py-5 hover:bg-ground-2 transition-colors"
              >
                <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
                  Learning playlist
                </p>
                <h3 className="font-display text-2xl mt-1">{featured.name}</h3>
                {featured.description && (
                  <p className="text-[14px] text-ink-70 mt-1 max-w-2xl">
                    {featured.description}
                  </p>
                )}
                <p className="text-[12px] text-ink-45 mt-2">
                  {featured.call_count} item{featured.call_count === 1 ? "" : "s"}
                  {featured.author_name && ` · put together by ${featured.author_name}`}
                </p>
              </button>
            </section>
          )}

          {moments.length > 0 && (
            <section className="mt-8">
              <SectionHead
                title="Recently added moments"
                action="All moments"
                onAction={() => onOpenTab("moments")}
              />
              <ul className="grid sm:grid-cols-2 gap-2.5">
                {moments.map((m) => {
                  const type = MOMENT_TYPES.find((t) => t.value === m.moment_type);
                  const colour =
                    m.moment_type === "model"
                      ? "#1F7A4D"
                      : m.moment_type === "recovery"
                        ? "#2C6E9B"
                        : m.moment_type === "miss"
                          ? "#AC3A2A"
                          : "#96690A";
                  return (
                    <li key={m.id}>
                      <button
                        onClick={() => onOpenCall(m.call_id)}
                        className="w-full text-left bg-card border border-rule-soft rounded px-4 py-3.5 hover:bg-ground-2 h-full"
                      >
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-display text-base">{m.title}</span>
                          <span
                            className="text-[10.5px] border rounded-full px-1.5 py-0.5"
                            style={{ color: colour, borderColor: colour }}
                          >
                            {type?.label ?? m.moment_type}
                          </span>
                        </div>
                        {m.coaching_note && (
                          <p className="text-[13px] text-ink-70 mt-1 line-clamp-2">
                            {m.coaching_note}
                          </p>
                        )}
                        <p className="font-mono text-[11px] text-ink-45 mt-1.5">
                          {formatDuration(m.duration_ms)} &middot; {m.agent_name ?? "—"}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {studies.length > 0 && (
            <section className="mt-8">
              <SectionHead
                title="Newest case studies"
                action="All case studies"
                onAction={() => onOpenTab("casestudies")}
              />
              <ul className="space-y-2.5">
                {studies.slice(0, 3).map((cs) => (
                  <li key={cs.id}>
                    <button
                      onClick={() => onOpenCaseStudy(cs.id)}
                      className="w-full text-left bg-card border border-rule-soft rounded px-4 py-3.5 hover:bg-ground-2"
                    >
                      <h3 className="font-display text-lg">{cs.title}</h3>
                      {cs.summary && (
                        <p className="text-[13.5px] text-ink-70 mt-0.5">{cs.summary}</p>
                      )}
                      <p className="text-[12px] text-ink-45 mt-1.5">
                        Drawn from {cs.source_count ?? 0} evaluation
                        {(cs.source_count ?? 0) === 1 ? "" : "s"}
                        {cs.author_name && ` · ${cs.author_name}`}
                        {" · "}
                        {formatDate(cs.updated_at)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {articles.length > 0 && (
            <section className="mt-8">
              <SectionHead
                title="Most read"
                action="All articles"
                onAction={() => onOpenTab("knowledge")}
              />
              <ul className="grid sm:grid-cols-2 gap-2.5">
                {[...articles]
                  .sort((a, b) => b.view_count - a.view_count)
                  .slice(0, 4)
                  .map((a) => (
                    <li key={a.id}>
                      <button
                        onClick={() => onOpenArticle(a.id)}
                        className="w-full text-left bg-card border border-rule-soft rounded px-4 py-3.5 hover:bg-ground-2 h-full"
                      >
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-display text-base">{a.title}</span>
                          {a.has_sop && (
                            <span className="text-[10.5px] border border-rule text-ink-45 rounded-full px-1.5 py-0.5">
                              includes SOP
                            </span>
                          )}
                        </div>
                        {a.summary && (
                          <p className="text-[13px] text-ink-70 mt-1 line-clamp-2">{a.summary}</p>
                        )}
                        <p className="font-mono text-[11px] text-ink-45 mt-1.5">
                          {a.section_count} section{a.section_count === 1 ? "" : "s"}
                          {a.view_count > 0 && ` · read ${a.view_count}×`}
                        </p>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          {evaluations.length > 0 && (
            <section className="mt-8">
              <SectionHead
                title="Recently completed"
                action="All evaluations"
                onAction={() => onOpenTab("evaluations")}
              />
              <ul className="space-y-2">
                {evaluations.map((e) => (
                  <li key={e.call_id}>
                    <button
                      onClick={() => onOpenRecord(e.call_id)}
                      className="w-full text-left bg-card border border-rule-soft rounded px-4 py-3 hover:bg-ground-2 flex justify-between items-baseline gap-3 flex-wrap"
                    >
                      <span className="text-[14px]">
                        {e.call_title}
                        <span className="text-ink-45 text-[12px] ml-2">{e.agent_name}</span>
                      </span>
                      <span className="font-mono text-[12px] text-ink-45">
                        {e.overall_score === null ? "—" : `${e.overall_score}%`}
                        {e.submitted_at && ` · ${formatDate(e.submitted_at)}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SectionHead({
  title,
  action,
  onAction,
}: {
  title: string;
  action: string;
  onAction: () => void;
}): JSX.Element {
  return (
    <div className="flex justify-between items-baseline gap-4 mb-2.5">
      <h2 className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
        {title}
      </h2>
      <button
        onClick={onAction}
        className="text-[12px] text-ink-45 underline underline-offset-2 hover:text-ink"
      >
        {action}
      </button>
    </div>
  );
}
