import { supabase } from "@/lib/supabase";

/**
 * Risk & escalations.
 *
 * A risk says something on this call needs attention beyond the score. It is
 * deliberately not part of scoring: a representative can score well and still
 * carry a serious risk, or score badly with none at all.
 */

export const RISK_CATEGORIES = [
  { value: "financial", label: "Financial", hint: "Possible financial exposure" },
  { value: "customer", label: "Customer / Author", hint: "Concerning interaction" },
  { value: "compliance", label: "Compliance / Policy", hint: "Possible policy issue" },
  { value: "behavioral", label: "Behavioral", hint: "Conduct needing coaching" },
  { value: "operational", label: "Operational", hint: "Process or system concern" },
  { value: "other", label: "Other", hint: "Something else worth attention" },
] as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[number]["value"];
export type RiskStatus = "open" | "resolved" | "closed";

export interface RiskRecord {
  id: string;
  call_id: string;
  call_title: string;
  representative_id: string | null;
  representative_name: string | null;
  employee_ref: string | null;
  department: string | null;
  category: RiskCategory;
  /** What the raiser called it, kept only if a trainer reclassified. */
  original_category: RiskCategory | null;
  was_reclassified: boolean;
  note: string;
  raised_by_kind: "raw_observation" | "calibrated";
  identified_by_role: string;
  identified_by: string | null;
  identified_at: string;
  /** Null until a trainer has looked — not the same as "found valid". */
  determination: "valid" | "not_a_risk" | null;
  determination_note: string;
  determined_by: string | null;
  determined_at: string | null;
  requires_escalation: boolean;
  status: RiskStatus;
  resolution_note: string;
  resolved_by: string | null;
  resolved_at: string | null;
  evaluation_id: string | null;
  evidence_count: number;
}

export interface RiskSummary {
  total: number;
  open: number;
  resolved: number;
  closed: number;
  /** Only what a trainer explicitly escalated — never a pre-calibration flag. */
  open_escalations: number;
  /** Raised but not yet judged. Deliberately not counted as an escalation. */
  awaiting_determination: number;
  confirmed_open: number;
}

/** The register. RLS scopes it: reviewers see what they raised. */
export async function riskRegister(status?: RiskStatus): Promise<RiskRecord[]> {
  let q = supabase.from("v_risk_register").select("*");
  if (status) q = q.eq("status", status);
  const { data, error } = await q.order("identified_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as RiskRecord[];
}

export async function riskSummary(): Promise<RiskSummary | null> {
  const { data, error } = await supabase.from("v_risk_summary").select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as RiskSummary | null;
}

/** Risks on one call — for calibration and the completed evaluation. */
export async function risksForCall(callId: string): Promise<RiskRecord[]> {
  const { data, error } = await supabase
    .from("v_call_risks")
    .select("*")
    .eq("call_id", callId)
    .order("identified_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as RiskRecord[];
}

/** Raising a risk. Available to reviewers observing and trainers calibrating. */
export async function raiseRisk(params: {
  callId: string;
  evaluationId: string;
  category: RiskCategory;
  note: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("raise_risk", {
    p_call_id: params.callId,
    p_evaluation_id: params.evaluationId,
    p_category: params.category,
    p_note: params.note,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * The trainer's determination, recorded alongside what the reviewer raised.
 * The original category and note are never overwritten.
 */
export async function determineRisk(params: {
  riskId: string;
  determination: "valid" | "not_a_risk";
  note?: string;
  category?: RiskCategory;
  requiresEscalation?: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc("determine_risk", {
    p_risk_id: params.riskId,
    p_determination: params.determination,
    p_note: params.note ?? "",
    p_category: params.category ?? null,
    p_requires_escalation: params.requiresEscalation ?? false,
  });
  if (error) throw new Error(error.message);
}

export async function setRiskStatus(
  riskId: string,
  status: RiskStatus,
  note = "",
): Promise<void> {
  const { error } = await supabase.rpc("set_risk_status", {
    p_risk_id: riskId,
    p_status: status,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}
