import { supabase } from "./supabase";
import type { WorkflowStatus } from "./workflow";
import type { ScoreValue } from "./evaluation";

export interface RepositoryRow {
  call_id: string;
  call_title: string;
  agent_name: string | null;
  customer_ref: string | null;
  occurred_at: string | null;
  duration_ms: number | null;
  workflow_status: WorkflowStatus;
  published_at: string | null;
  published_url: string | null;
  case_study_status: "not_created" | "draft" | "published";
  evaluation_id: string;
  overall_score: number | null;
  reward_tier: string | null;
  checklist_all_yes: boolean | null;
  non_negotiables_all_pass: boolean | null;
  author_end_state: string | null;
  is_high_risk: boolean;
  summary_note: string;
  submitted_at: string | null;
  evaluation_status: string;
  under_revision: boolean;
  superseded_count: number;
  rubric_version: string | null;
  trainer_name: string | null;
  reviewer_name: string | null;
  raw_evaluation_id: string | null;
  raw_submitted_at: string | null;
  evidence_count: number;
  moment_count: number;
  calibration_changes: number;
  storage_path: string | null;
  /** Optional call description (0062). Searched alongside call_title. */
  call_notes: string | null;
}

export interface RecordScore {
  score_id: string;
  criterion_id: string;
  code: string;
  stage: string;
  label: string;
  statement: string;
  section_title: string;
  section_kind: "checklist" | "non_negotiable";
  sort_order: number;
  raw_value: ScoreValue | null;
  final_value: ScoreValue | null;
  changed: boolean;
  remark: string;
}

export interface VersionRow {
  id: string;
  status: string;
  overall_score: number | null;
  reward_tier: string | null;
  submitted_at: string | null;
  created_at: string;
  supersedes_id: string | null;
  rubric_version: string | null;
  evaluator_name: string | null;
}

export async function listRepository(): Promise<RepositoryRow[]> {
  const { data, error } = await supabase
    .from("v_quality_repository")
    .select("*")
    .order("submitted_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RepositoryRow[];
}

export async function getRepositoryRecord(callId: string): Promise<RepositoryRow | null> {
  const { data } = await supabase
    .from("v_quality_repository")
    .select("*")
    .eq("call_id", callId)
    .maybeSingle<RepositoryRow>();
  return data;
}

export async function getRecordScores(evaluationId: string): Promise<RecordScore[]> {
  const { data, error } = await supabase
    .from("v_quality_record_scores")
    .select("*")
    .eq("evaluation_id", evaluationId)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as RecordScore[];
}

export async function getVersions(callId: string): Promise<VersionRow[]> {
  const { data } = await supabase
    .from("v_evaluation_versions")
    .select("*")
    .eq("call_id", callId)
    .order("created_at", { ascending: false });
  return (data ?? []) as VersionRow[];
}

/** Corrections never overwrite: this creates a successor and retires the original. */
export async function supersedeEvaluation(evaluationId: string): Promise<string> {
  const { data, error } = await supabase.rpc("supersede_evaluation", {
    p_evaluation_id: evaluationId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface RepositoryStats {
  completed: number;
  averageScore: number | null;
  moments: number;
  evidence: number;
  pendingPublication: number;
}

export function statsFrom(rows: RepositoryRow[]): RepositoryStats {
  const scored = rows.filter((r) => r.overall_score !== null);
  return {
    completed: rows.length,
    averageScore:
      scored.length > 0
        ? Math.round(
            (scored.reduce((s, r) => s + (r.overall_score ?? 0), 0) / scored.length) * 10,
          ) / 10
        : null,
    moments: rows.reduce((s, r) => s + r.moment_count, 0),
    evidence: rows.reduce((s, r) => s + r.evidence_count, 0),
    pendingPublication: rows.filter((r) => r.published_at === null).length,
  };
}
