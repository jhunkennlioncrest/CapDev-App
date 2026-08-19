import { supabase } from "./supabase";

export type VersionStatus = "draft" | "review" | "active" | "archived";

export interface RubricVersionRow {
  id: string;
  rubric_id: string;
  version_label: string;
  title: string;
  description: string;
  status: VersionStatus;
  effective_date: string | null;
  change_summary: string;
  requested_by: string;
  approved_by: string;
  source_document: string;
  created_at: string;
  activated_at: string | null;
  archived_at: string | null;
  submitted_for_review_at: string | null;
  created_by_name: string | null;
  criterion_count: number;
  evaluations_using: number;
}

export interface FlatCriterion {
  version_id: string;
  version_label: string;
  section_code: string;
  section_title: string;
  section_kind: "checklist" | "non_negotiable";
  section_order: number;
  criterion_id: string;
  code: string;
  stage: string;
  label: string;
  statement: string;
  guidance: string[];
  na_condition: string;
  requires_remark_on_no: boolean;
  sort_order: number;
}

export interface SectionRow {
  id: string;
  version_id: string;
  code: string;
  title: string;
  kind: "checklist" | "non_negotiable";
  description: string;
  sort_order: number;
}

export async function listVersions(): Promise<RubricVersionRow[]> {
  const { data, error } = await supabase
    .from("v_rubric_versions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RubricVersionRow[];
}

export async function getCriteria(versionId: string): Promise<FlatCriterion[]> {
  const { data, error } = await supabase
    .from("v_rubric_criteria_flat")
    .select("*")
    .eq("version_id", versionId)
    .order("section_order")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as FlatCriterion[];
}

export async function getSections(versionId: string): Promise<SectionRow[]> {
  const { data, error } = await supabase
    .from("rubric_section")
    .select("*")
    .eq("version_id", versionId)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as SectionRow[];
}

// ---- lifecycle -----------------------------------------------------------

export async function createDraft(
  label: string,
  title: string,
  description = "",
): Promise<string> {
  const { data, error } = await supabase.rpc("create_rubric_draft", {
    p_version_label: label,
    p_title: title,
    p_description: description,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function copyVersion(
  sourceId: string,
  label: string,
  title?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("copy_rubric_version", {
    p_source_id: sourceId,
    p_new_label: label,
    p_title: title ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function submitForReview(id: string): Promise<void> {
  const { error } = await supabase.rpc("submit_rubric_for_review", { p_version_id: id });
  if (error) throw new Error(error.message);
}

export async function returnToDraft(id: string): Promise<void> {
  const { error } = await supabase.rpc("return_rubric_to_draft", { p_version_id: id });
  if (error) throw new Error(error.message);
}

export async function activateVersion(id: string): Promise<void> {
  const { error } = await supabase.rpc("activate_rubric_version", { p_version_id: id });
  if (error) throw new Error(error.message);
}

export async function deleteDraft(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_rubric_draft", { p_version_id: id });
  if (error) throw new Error(error.message);
}

export async function updateVersionMeta(
  id: string,
  patch: Partial<
    Pick<
      RubricVersionRow,
      "title" | "description" | "change_summary" | "requested_by" | "approved_by" | "effective_date"
    >
  >,
): Promise<void> {
  const { error } = await supabase.from("rubric_version").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

// ---- criterion editing (drafts only; the database enforces that) ----------

export async function updateCriterion(
  id: string,
  patch: Partial<
    Pick<
      FlatCriterion,
      "code" | "stage" | "label" | "statement" | "guidance" | "na_condition" | "sort_order"
    >
  >,
): Promise<void> {
  const { error } = await supabase.from("rubric_criterion").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function addCriterion(params: {
  versionId: string;
  sectionId: string;
  code: string;
  label: string;
  statement: string;
  stage?: string;
  sortOrder: number;
}): Promise<void> {
  const { error } = await supabase.from("rubric_criterion").insert({
    version_id: params.versionId,
    section_id: params.sectionId,
    code: params.code,
    label: params.label,
    statement: params.statement,
    stage: params.stage ?? "",
    sort_order: params.sortOrder,
  });
  if (error) throw new Error(error.message);
}

export async function removeCriterion(id: string): Promise<void> {
  const { error } = await supabase.from("rubric_criterion").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function addSection(params: {
  versionId: string;
  code: string;
  title: string;
  kind: "checklist" | "non_negotiable";
  sortOrder: number;
}): Promise<string> {
  const { data, error } = await supabase
    .from("rubric_section")
    .insert({
      version_id: params.versionId,
      code: params.code,
      title: params.title,
      kind: params.kind,
      sort_order: params.sortOrder,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

// ---- comparison ----------------------------------------------------------

export type ChangeKind = "added" | "removed" | "modified" | "unchanged";

export interface CriterionDiff {
  code: string;
  change: ChangeKind;
  left: FlatCriterion | null;   // the older version
  right: FlatCriterion | null;  // the newer version
  fields: string[];             // which parts differ
}

/**
 * Compares two versions criterion by criterion, matched on code.
 *
 * Written for an executive reading it, not for a machine: it reports which
 * criteria appeared, disappeared, or changed wording, rather than producing a
 * character-level diff nobody can act on.
 */
export function compareVersions(
  older: FlatCriterion[],
  newer: FlatCriterion[],
): CriterionDiff[] {
  const byCode = (list: FlatCriterion[]): Map<string, FlatCriterion> =>
    new Map(list.map((c) => [c.code, c]));

  const left = byCode(older);
  const right = byCode(newer);
  const codes = [...new Set([...left.keys(), ...right.keys()])].sort();

  return codes.map((code) => {
    const a = left.get(code) ?? null;
    const b = right.get(code) ?? null;

    if (!a) return { code, change: "added" as const, left: null, right: b, fields: [] };
    if (!b) return { code, change: "removed" as const, left: a, right: null, fields: [] };

    const fields: string[] = [];
    if (a.statement !== b.statement) fields.push("wording");
    if (a.label !== b.label) fields.push("name");
    if (a.stage !== b.stage) fields.push("stage");
    if (a.na_condition !== b.na_condition) fields.push("N/A condition");
    if (JSON.stringify(a.guidance) !== JSON.stringify(b.guidance)) fields.push("guidance");
    if (a.section_kind !== b.section_kind) fields.push("section");
    if (a.requires_remark_on_no !== b.requires_remark_on_no) fields.push("scoring");

    return {
      code,
      change: fields.length > 0 ? ("modified" as const) : ("unchanged" as const),
      left: a,
      right: b,
      fields,
    };
  });
}

// ---- import --------------------------------------------------------------

export interface ParsedCriterion {
  section: string;
  kind: "checklist" | "non_negotiable";
  code: string;
  stage: string;
  label: string;
  statement: string;
  na_condition: string;
}

/**
 * Parses pasted or uploaded delimited text into criteria.
 *
 * Deliberately tolerant and deliberately not silent: whatever it produces is
 * shown for confirmation before anything is created. A misread column costs a
 * correction, never a wrong rubric.
 */
export function parseDelimited(text: string): {
  rows: ParsedCriterion[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { rows: [], warnings: ["Nothing to read."] };

  // Tab wins over comma: statements routinely contain commas, rarely tabs.
  const delimiter = (lines[0] ?? "").includes("\t") ? "\t" : ",";

  const split = (line: string): string[] => {
    if (delimiter === "\t") return line.split("\t").map((c) => c.trim());
    // Minimal CSV handling: respect quoted fields.
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (ch === "," && !quoted) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const header = split(lines[0] ?? "").map((h) => h.toLowerCase());
  const looksLikeHeader = header.some((h) =>
    ["code", "criterion", "statement", "section", "label"].includes(h),
  );

  const idx = (...names: string[]): number => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const cCode = looksLikeHeader ? idx("code", "id", "ref") : 0;
  const cSection = looksLikeHeader ? idx("section", "category") : -1;
  const cStage = looksLikeHeader ? idx("stage", "phase") : -1;
  const cLabel = looksLikeHeader ? idx("label", "name", "title") : 1;
  const cStatement = looksLikeHeader
    ? idx("statement", "criterion", "description", "text")
    : 2;
  const cNa = looksLikeHeader ? idx("na", "na_condition", "n/a", "n/a if") : -1;

  if (cStatement === -1) {
    warnings.push(
      "Couldn't identify a statement column. Expected a header containing " +
        '"statement", "criterion" or "description".',
    );
  }

  const body = looksLikeHeader ? lines.slice(1) : lines;
  const rows: ParsedCriterion[] = [];

  for (const line of body) {
    const cells = split(line);
    const statement = (cStatement >= 0 ? cells[cStatement] : cells[2]) ?? "";
    if (!statement.trim()) continue;

    const code = (cCode >= 0 ? cells[cCode] : "") ?? "";
    const sectionText = (cSection >= 0 ? cells[cSection] : "") ?? "";

    // NN codes and anything labelled non-negotiable go to the NN section.
    const isNN =
      /^nn/i.test(code.trim()) || /non.?negotiable/i.test(sectionText);

    rows.push({
      section: sectionText || (isNN ? "The Non-Negotiables" : "Checklist"),
      kind: isNN ? "non_negotiable" : "checklist",
      code: code.trim() || `C${rows.length + 1}`,
      stage: (cStage >= 0 ? cells[cStage] : "")?.trim() ?? "",
      label: (cLabel >= 0 ? cells[cLabel] : "")?.trim() ?? "",
      statement: statement.trim(),
      na_condition: (cNa >= 0 ? cells[cNa] : "")?.trim() ?? "",
    });
  }

  if (rows.length === 0) warnings.push("No rows with a statement were found.");
  if (!looksLikeHeader) {
    warnings.push(
      "No header row detected — assumed the columns are code, name, statement. " +
        "Check the preview carefully.",
    );
  }

  return { rows, warnings };
}

/** Creates a draft from parsed rows. Nothing is created until this is called. */
export async function createDraftFromImport(params: {
  label: string;
  title: string;
  sourceDocument: string;
  rows: ParsedCriterion[];
}): Promise<string> {
  const versionId = await createDraft(params.label, params.title);

  await supabase
    .from("rubric_version")
    .update({ source_document: params.sourceDocument })
    .eq("id", versionId);

  const checklist = params.rows.filter((r) => r.kind === "checklist");
  const nonNeg = params.rows.filter((r) => r.kind === "non_negotiable");

  let order = 0;
  if (checklist.length > 0) {
    const sectionId = await addSection({
      versionId,
      code: "S1",
      title: "Objective Call-Handling Checklist",
      kind: "checklist",
      sortOrder: 1,
    });
    for (const r of checklist) {
      await addCriterion({
        versionId,
        sectionId,
        code: r.code,
        label: r.label,
        statement: r.statement,
        stage: r.stage,
        sortOrder: ++order,
      });
    }
  }

  if (nonNeg.length > 0) {
    const sectionId = await addSection({
      versionId,
      code: "S2",
      title: "The Non-Negotiables",
      kind: "non_negotiable",
      sortOrder: 2,
    });
    for (const r of nonNeg) {
      await addCriterion({
        versionId,
        sectionId,
        code: r.code,
        label: r.label,
        statement: r.statement,
        stage: r.stage,
        sortOrder: ++order,
      });
    }
  }

  return versionId;
}
