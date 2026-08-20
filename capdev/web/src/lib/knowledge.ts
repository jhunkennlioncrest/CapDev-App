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


// ---------------------------------------------------------------------------
// Citations
//
// An article points at knowledge that already exists rather than restating it.
// A teaching moment cited in three articles is still one moment: correct it
// once and every article that cites it is correct too.

export type ReferenceType =
  | "moment"
  | "case_study"
  | "evaluation"
  | "rubric_criterion";

export interface ArticleReference {
  id: string;
  article_id: string;
  subject_type: ReferenceType;
  subject_id: string;
  note: string;
  sort_order: number;
  /** Resolved for display; never stored on the reference. */
  title?: string;
  subtitle?: string;
}

export const REFERENCE_TYPES: {
  value: ReferenceType;
  label: string;
  plural: string;
}[] = [
  { value: "moment", label: "Teaching moment", plural: "Teaching moments" },
  { value: "case_study", label: "Case study", plural: "Case studies" },
  { value: "evaluation", label: "Completed evaluation", plural: "Source evaluations" },
  { value: "rubric_criterion", label: "Rubric criterion", plural: "Rubric criteria" },
];

/** A thing that can be cited, in a shape the picker can list. */
export interface CitableAsset {
  id: string;
  title: string;
  subtitle: string;
}

export async function listCitable(type: ReferenceType): Promise<CitableAsset[]> {
  if (type === "moment") {
    const { data } = await supabase
      .from("v_moment_list")
      .select("id, title, coaching_note, moment_type")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(200);
    return ((data ?? []) as {
      id: string;
      title: string;
      coaching_note: string;
      moment_type: string;
    }[]).map((m) => ({
      id: m.id,
      title: m.title,
      subtitle: m.moment_type,
    }));
  }

  if (type === "case_study") {
    const { data } = await supabase
      .from("v_case_study_list")
      .select("id, title, summary")
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(200);
    return ((data ?? []) as { id: string; title: string; summary: string }[]).map((c) => ({
      id: c.id,
      title: c.title,
      subtitle: c.summary,
    }));
  }

  if (type === "evaluation") {
    const { data } = await supabase
      .from("v_quality_repository")
      .select("evaluation_id, call_title, agent_name, overall_score")
      .order("submitted_at", { ascending: false })
      .limit(200);
    return ((data ?? []) as {
      evaluation_id: string;
      call_title: string;
      agent_name: string | null;
      overall_score: number | null;
    }[]).map((e) => ({
      id: e.evaluation_id,
      title: e.call_title,
      subtitle: [e.agent_name, e.overall_score === null ? null : `${e.overall_score}%`]
        .filter(Boolean)
        .join(" · "),
    }));
  }

  // Criteria come from the active rubric: citing a retired criterion would
  // point readers at a standard no longer in force.
  const { data } = await supabase
    .from("v_rubric_criteria_flat")
    .select("criterion_id, code, label, statement, status")
    .eq("status", "active")
    .order("sort_order");
  return ((data ?? []) as {
    criterion_id: string;
    code: string;
    label: string;
    statement: string;
  }[]).map((c) => ({
    id: c.criterion_id,
    title: `${c.code}${c.label ? ` — ${c.label}` : ""}`,
    subtitle: c.statement,
  }));
}

export async function getReferences(articleId: string): Promise<ArticleReference[]> {
  const { data, error } = await supabase
    .from("knowledge_article_reference")
    .select("*")
    .eq("article_id", articleId)
    .order("sort_order");
  if (error) throw new Error(error.message);

  const refs = (data ?? []) as ArticleReference[];
  if (refs.length === 0) return [];

  // Resolve titles by type, so a renamed asset shows its current name.
  const resolved = await Promise.all(
    REFERENCE_TYPES.map(async ({ value }) => {
      const ofType = refs.filter((r) => r.subject_type === value);
      if (ofType.length === 0) return [];
      const all = await listCitable(value);
      const byId = new Map(all.map((a) => [a.id, a]));
      return ofType.map((r) => ({
        ...r,
        title: byId.get(r.subject_id)?.title ?? "(no longer available)",
        subtitle: byId.get(r.subject_id)?.subtitle ?? "",
      }));
    }),
  );

  const flat = resolved.flat();
  return refs.map((r) => flat.find((x) => x.id === r.id) ?? r);
}

export async function addReference(params: {
  articleId: string;
  subjectType: ReferenceType;
  subjectId: string;
  sortOrder: number;
}): Promise<void> {
  const { error } = await supabase.from("knowledge_article_reference").insert({
    article_id: params.articleId,
    subject_type: params.subjectType,
    subject_id: params.subjectId,
    sort_order: params.sortOrder,
  });
  // Citing the same thing twice is a no-op, not a failure.
  if (error && !error.message.includes("duplicate")) throw new Error(error.message);
}

export async function removeReference(id: string): Promise<void> {
  const { error } = await supabase.from("knowledge_article_reference").delete().eq("id", id);
  if (error) throw new Error(error.message);
}


// ---------------------------------------------------------------------------
// Case studies derived from completed evaluations
//
// The evaluation is what happened; the case study is what we learned from it.
// Everything the evaluation already holds is referenced, never retyped and
// never copied — so a bounded clip keeps its exact boundaries and the
// evaluation stays the authoritative record.

export interface SourceOption {
  evaluation_id: string;
  call_id: string;
  call_title: string;
  agent_name: string | null;
  overall_score: number | null;
  submitted_at: string;
  reviewer_name: string | null;
  trainer_name: string | null;
  evidence_count: number;
  moment_count: number;
  failed_criteria: number;
  /** How many case studies already draw on this. Never a reason to exclude it. */
  used_in_case_studies: number;
  used_by: string | null;
}

export interface CaseStudyEvidence {
  link_id: string;
  evidence_id: string;
  call_id: string | null;
  call_title: string | null;
  start_ms: number | null;
  end_ms: number | null;
  excerpt: string;
  criterion_code: string | null;
  added_here: boolean;
}

export interface CaseStudyMoment {
  link_id: string;
  moment_id: string;
  title: string;
  coaching_note: string;
  moment_type: string;
  start_ms: number | null;
  end_ms: number | null;
  call_id: string;
}

/**
 * Completed evaluations available as source material.
 *
 * Every submitted calibration, regardless of how many case studies already
 * cite it. A great call may teach several different lessons, so prior use is
 * reported and never filtered.
 */
export async function listSourceOptions(): Promise<SourceOption[]> {
  const { data, error } = await supabase
    .from("v_case_study_source_options")
    .select("*")
    .order("submitted_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as SourceOption[];
}

export interface CallCaseStudy {
  case_study_id: string;
  title: string;
  status: string;
  author_name: string | null;
  updated_at: string;
}

/** Which case studies already draw on a call — a list, not a status. */
export async function caseStudiesForCall(callId: string): Promise<CallCaseStudy[]> {
  const { data } = await supabase
    .from("v_call_case_studies")
    .select("case_study_id, title, status, author_name, updated_at")
    .eq("call_id", callId)
    .order("updated_at", { ascending: false });
  return (data ?? []) as CallCaseStudy[];
}

/** Links everything the source evaluations already contain. Copies nothing. */
export async function seedFromSources(
  caseStudyId: string,
): Promise<{ evidence: number; moments: number }> {
  const { data, error } = await supabase.rpc("seed_case_study_from_sources", {
    p_case_study_id: caseStudyId,
  });
  if (error) throw new Error(error.message);
  const row = (data as { evidence_linked: number; moments_linked: number }[])?.[0];
  return { evidence: row?.evidence_linked ?? 0, moments: row?.moments_linked ?? 0 };
}

export async function getCaseStudyEvidence(id: string): Promise<CaseStudyEvidence[]> {
  const { data, error } = await supabase
    .from("v_case_study_evidence")
    .select("*")
    .eq("case_study_id", id)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as CaseStudyEvidence[];
}

export async function getCaseStudyMoments(id: string): Promise<CaseStudyMoment[]> {
  const { data, error } = await supabase
    .from("v_case_study_moments")
    .select("*")
    .eq("case_study_id", id)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as CaseStudyMoment[];
}

/** Removes something from the case study. The underlying record is untouched. */
export async function unlinkEvidence(linkId: string): Promise<void> {
  const { error } = await supabase.from("case_study_evidence").delete().eq("id", linkId);
  if (error) throw new Error(error.message);
}

export async function unlinkMoment(linkId: string): Promise<void> {
  const { error } = await supabase.from("case_study_moment").delete().eq("id", linkId);
  if (error) throw new Error(error.message);
}

export async function linkMoment(params: {
  caseStudyId: string;
  momentId: string;
  sortOrder: number;
}): Promise<void> {
  const { error } = await supabase.from("case_study_moment").insert({
    case_study_id: params.caseStudyId,
    moment_id: params.momentId,
    sort_order: params.sortOrder,
  });
  if (error && !error.message.includes("duplicate")) throw new Error(error.message);
}

/**
 * Builds an opening draft of the situation and what happened.
 *
 * Written as prose a person would recognise, not dumped fields: the trainer
 * should be editing a paragraph, not deleting a database printout. Why it
 * mattered and what to do instead are deliberately left empty — those are the
 * parts that make it a case study.
 */
export function draftNarrative(
  sources: SourceOption[],
  failures: { code: string; statement: string; remark: string }[],
): { scenario: string; whatHappened: string; title: string } {
  const first = sources[0];
  const multi = sources.length > 1;

  const scenario = multi
    ? `This looks at ${sources.length} calls where a similar pattern appeared: ` +
      sources.map((s) => `${s.call_title} (${s.agent_name ?? "rep not recorded"})`).join(", ") +
      "."
    : first
      ? `${first.agent_name ?? "The representative"} was handling ${first.call_title}. ` +
        `The call was reviewed by ${first.reviewer_name ?? "a reviewer"} and calibrated by ` +
        `${first.trainer_name ?? "a trainer"}.`
      : "";

  const lines: string[] = [];
  if (failures.length > 0) {
    lines.push(
      failures.length === 1
        ? "Calibration found one criterion was not met:"
        : `Calibration found ${failures.length} criteria were not met:`,
    );
    for (const f of failures) {
      lines.push(`· ${f.statement}${f.remark ? ` — ${f.remark}` : ""}`);
    }
  } else if (first) {
    lines.push(
      `Calibration found every applicable criterion was met` +
        (first.overall_score !== null ? `, scoring ${first.overall_score}%.` : "."),
    );
  }

  const title = multi
    ? ""
    : first
      ? `${first.call_title} — what it teaches`
      : "";

  return { scenario, whatHappened: lines.join("\n"), title };
}
