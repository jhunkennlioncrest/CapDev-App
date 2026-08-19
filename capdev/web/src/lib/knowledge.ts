import { supabase } from "./supabase";

/**
 * The knowledge layer.
 *
 * Everything here is created after a Completed Evaluation exists. Lifecycle is
 * deliberately two states — active and archived. Knowledge is available the
 * moment it is written; a draft/review/publish workflow would be one person
 * approving their own work.
 */

export type AssetStatus = "active" | "archived";
export type SubjectType = "call" | "moment" | "case_study" | "evaluation";

export interface CaseStudy {
  id: string;
  title: string;
  summary: string;
  scenario: string;
  what_happened: string;
  why_it_mattered: string;
  recommended_approach: string;
  learning_questions: string[];
  criterion_ids: string[];
  status: AssetStatus;
  created_at: string;
  updated_at: string;
  author_name?: string | null;
  source_count?: number;
  agent_names?: string | null;
}

export interface ArticleSection {
  id: string;
  article_id: string;
  kind:
    | "purpose"
    | "business_context"
    | "sop"
    | "best_practice"
    | "common_mistakes"
    | "references"
    | "free_text";
  heading: string;
  body: string;
  sort_order: number;
}

export const SECTION_KINDS: { value: ArticleSection["kind"]; label: string; hint: string }[] = [
  { value: "purpose", label: "Purpose", hint: "What this covers and why it exists" },
  { value: "business_context", label: "Business context", hint: "Where this sits in the work" },
  { value: "sop", label: "SOP", hint: "The procedure, when there is one" },
  { value: "best_practice", label: "Best practice", hint: "What good looks like" },
  { value: "common_mistakes", label: "Common mistakes", hint: "What goes wrong, and why" },
  { value: "references", label: "References", hint: "Where to read further" },
  { value: "free_text", label: "Other", hint: "Anything else" },
];

export interface KnowledgeArticle {
  id: string;
  title: string;
  summary: string;
  topic: string;
  status: AssetStatus;
  view_count: number;
  created_at: string;
  updated_at: string;
  author_name?: string | null;
  section_count?: number;
  reference_count?: number;
  has_sop?: boolean;
}

export interface PlaylistItem {
  id: string;
  playlist_id: string;
  subject_type: SubjectType;
  subject_id: string;
  sort_order: number;
  note: string;
  title: string | null;
  subtitle: string | null;
  call_id: string | null;
  start_ms: number | null;
  end_ms: number | null;
  moment_type: string | null;
  overall_score: number | null;
}

// ---- case studies --------------------------------------------------------

export async function listCaseStudies(): Promise<CaseStudy[]> {
  const { data, error } = await supabase
    .from("v_case_study_list")
    .select("*")
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CaseStudy[];
}

export async function getCaseStudy(id: string): Promise<CaseStudy | null> {
  const { data } = await supabase
    .from("case_study")
    .select("*")
    .eq("id", id)
    .maybeSingle<CaseStudy>();
  return data;
}

/**
 * Creates a case study already carrying its evidence.
 *
 * The failure mode of any authoring tool is the blank page, so this arrives
 * populated with what the evaluation already knows. The trainer's work is
 * interpretation, not transcription.
 */
export async function createCaseStudyFrom(params: {
  orgId: string;
  personId: string;
  evaluationIds: string[];
  title: string;
  prefill: Partial<
    Pick<CaseStudy, "scenario" | "what_happened" | "why_it_mattered" | "criterion_ids">
  >;
}): Promise<string> {
  const { data, error } = await supabase
    .from("case_study")
    .insert({
      org_id: params.orgId,
      title: params.title,
      scenario: params.prefill.scenario ?? "",
      what_happened: params.prefill.what_happened ?? "",
      why_it_mattered: params.prefill.why_it_mattered ?? "",
      criterion_ids: params.prefill.criterion_ids ?? [],
      created_by: params.personId,
      updated_by: params.personId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const id = (data as { id: string }).id;

  if (params.evaluationIds.length > 0) {
    const { error: srcError } = await supabase.from("case_study_source").insert(
      params.evaluationIds.map((evaluation_id, i) => ({
        case_study_id: id,
        evaluation_id,
        sort_order: i + 1,
      })),
    );
    if (srcError) throw new Error(srcError.message);
  }

  return id;
}

export async function updateCaseStudy(
  id: string,
  patch: Partial<CaseStudy>,
): Promise<void> {
  const { error } = await supabase.from("case_study").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function archiveCaseStudy(id: string): Promise<void> {
  const { error } = await supabase
    .from("case_study")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function caseStudySources(caseStudyId: string): Promise<
  { evaluation_id: string; call_title: string; overall_score: number | null }[]
> {
  const { data } = await supabase
    .from("case_study_source")
    .select("evaluation_id")
    .eq("case_study_id", caseStudyId)
    .order("sort_order");

  const ids = ((data ?? []) as { evaluation_id: string }[]).map((r) => r.evaluation_id);
  if (ids.length === 0) return [];

  const { data: evals } = await supabase
    .from("evaluation")
    .select("id, overall_score, call_id")
    .in("id", ids);

  const callIds = ((evals ?? []) as { call_id: string }[]).map((e) => e.call_id);
  const { data: calls } = await supabase.from("call").select("id, title").in("id", callIds);
  const titles = new Map(
    ((calls ?? []) as { id: string; title: string }[]).map((c) => [c.id, c.title]),
  );

  return ((evals ?? []) as { id: string; overall_score: number | null; call_id: string }[]).map(
    (e) => ({
      evaluation_id: e.id,
      call_title: titles.get(e.call_id) ?? "Untitled call",
      overall_score: e.overall_score,
    }),
  );
}

// ---- knowledge articles --------------------------------------------------

export async function listArticles(): Promise<KnowledgeArticle[]> {
  const { data, error } = await supabase
    .from("v_knowledge_article_list")
    .select("*")
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as KnowledgeArticle[];
}

export async function getArticle(id: string): Promise<KnowledgeArticle | null> {
  const { data } = await supabase
    .from("knowledge_article")
    .select("*")
    .eq("id", id)
    .maybeSingle<KnowledgeArticle>();
  return data;
}

export async function getArticleSections(articleId: string): Promise<ArticleSection[]> {
  const { data, error } = await supabase
    .from("knowledge_article_section")
    .select("*")
    .eq("article_id", articleId)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as ArticleSection[];
}

export async function createArticle(params: {
  orgId: string;
  personId: string;
  title: string;
  topic?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from("knowledge_article")
    .insert({
      org_id: params.orgId,
      title: params.title,
      topic: params.topic ?? "",
      created_by: params.personId,
      updated_by: params.personId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function updateArticle(
  id: string,
  patch: Partial<KnowledgeArticle>,
): Promise<void> {
  const { error } = await supabase.from("knowledge_article").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function addSection(params: {
  articleId: string;
  kind: ArticleSection["kind"];
  heading: string;
  sortOrder: number;
}): Promise<void> {
  const { error } = await supabase.from("knowledge_article_section").insert({
    article_id: params.articleId,
    kind: params.kind,
    heading: params.heading,
    sort_order: params.sortOrder,
  });
  if (error) throw new Error(error.message);
}

export async function updateSection(
  id: string,
  patch: Partial<Pick<ArticleSection, "heading" | "body" | "sort_order" | "kind">>,
): Promise<void> {
  const { error } = await supabase.from("knowledge_article_section").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeSection(id: string): Promise<void> {
  const { error } = await supabase.from("knowledge_article_section").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Counts a read. Cheap signal for what the organisation actually consults. */
export async function recordArticleView(id: string, current: number): Promise<void> {
  await supabase.from("knowledge_article").update({ view_count: current + 1 }).eq("id", id);
}

// ---- playlists (polymorphic) ---------------------------------------------

export async function getPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
  const { data, error } = await supabase
    .from("v_playlist_items")
    .select("*")
    .eq("playlist_id", playlistId)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as PlaylistItem[];
}

export async function addPlaylistItem(params: {
  playlistId: string;
  subjectType: SubjectType;
  subjectId: string;
  personId: string;
  sortOrder: number;
}): Promise<void> {
  const { error } = await supabase.from("playlist_item").insert({
    playlist_id: params.playlistId,
    subject_type: params.subjectType,
    subject_id: params.subjectId,
    added_by: params.personId,
    sort_order: params.sortOrder,
  });
  if (error && !error.message.includes("duplicate")) throw new Error(error.message);
}

export async function removePlaylistItem(id: string): Promise<void> {
  const { error } = await supabase.from("playlist_item").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
