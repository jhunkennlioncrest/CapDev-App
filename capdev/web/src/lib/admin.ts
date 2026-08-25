import { supabase } from "./supabase";

/** What the invitation endpoint may tell the browser. */
export type InvitationStatus =
  | "invited"
  | "already_has_account"
  | "already_invited"
  | "rate_limited"
  | "not_allowed"
  | "not_found"
  | "failed";

/**
 * Sends the Supabase Auth invitation.
 *
 * Only a person ID crosses the wire. The address is resolved server-side from
 * that record, so a caller cannot invite an arbitrary email by pointing at a
 * legitimate person. The service-role key never leaves the Edge Function.
 */
export async function sendInvitation(personId: string): Promise<InvitationStatus> {
  const { data, error } = await supabase.functions.invoke("invite-user", {
    body: { personId },
  });

  const status = (data as { status?: InvitationStatus } | null)?.status;
  if (status) return status;

  // On a non-2xx, supabase-js leaves data null and the body unparsed — the
  // status the function sent is only reachable through error.context. Without
  // this, "not_allowed" and "rate_limited" both collapsed into "failed" and
  // the administrator was told nothing useful.
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.text === "function") {
    try {
      const parsed = JSON.parse(await context.text()) as { status?: InvitationStatus };
      if (parsed?.status) return parsed.status;
    } catch {
      // Unreadable or not JSON; fall through to the generic failure.
    }
  }
  return "failed";
}

export interface AdminUser {
  id: string;
  display_name: string;
  email: string;
  status: "invited" | "active" | "suspended" | "offboarded" | "archived";
  department: string;
  last_login_at: string | null;
  invited_at: string | null;
  created_at: string;
  archived_at: string | null;
  roles: string[];
  last_raw_submitted: string | null;
  last_calibration: string | null;
  raw_count: number;
  calibration_count: number;
  /** Null until an invitation email has actually been accepted by Supabase. */
  invitation_sent_at: string | null;
  /**
   * Whether this person can sign in at all.
   *
   * The authoritative signal, not last_login_at: someone who accepted an
   * invitation and set a password but has not signed in yet has an account
   * and no login, and must not be offered another invitation.
   */
  has_auth_account: boolean;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string;
}

/**
 * Which role a person primarily holds. The model supports several, but one is
 * almost always the answer to "what is this person" — the exception being a
 * small team where a reviewer also calibrates.
 */
export const PRIMARY_ORDER = ["administrator", "qa_trainer", "raw_qa_reviewer", "manager"];

export interface RubricVersionRow {
  id: string;
  rubric_id: string;
  version_label: string;
  title: string;
  status: "draft" | "active" | "archived";
  effective_date: string | null;
  change_summary: string;
  created_at: string;
  activated_at: string | null;
  archived_at: string | null;
  rubric_name: string;
  created_by_name: string | null;
  criterion_count: number;
  evaluations_using: number;
}

export interface Integration {
  id: string;
  provider: "elevenlabs" | "notion";
  display_name: string;
  status: "not_configured" | "connected" | "error" | "disabled";
  config: Record<string, unknown>;
  last_verified_at: string | null;
  last_error: string | null;
  configured_by: string | null;
}

export async function listUsers(): Promise<AdminUser[]> {
  const { data, error } = await supabase
    .from("v_admin_users")
    .select("*")
    .order("display_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminUser[];
}

export async function listRoles(): Promise<Role[]> {
  const { data, error } = await supabase
    .from("app_role")
    .select("id, code, name, description")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Role[];
}

/**
 * Invites someone by creating their Person row ahead of first sign-in.
 * The existing auth trigger links them when they sign in with Google, so no
 * email or password handling is needed here.
 */
/**
 * Adds someone to the platform.
 *
 * This does NOT send an email — there is no mail service. It grants access, and
 * the person signs in themselves with Google. Links immediately if they already
 * have an account from opening the app previously.
 */
export async function inviteUser(params: {
  orgId: string;
  personId: string;
  email: string;
  displayName: string;
  department?: string;
  roleId?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("add_person", {
    p_email: params.email.trim().toLowerCase(),
    p_display_name: params.displayName.trim(),
    p_department: params.department ?? "",
    p_role_id: params.roleId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function setUserStatus(
  personId: string,
  status: AdminUser["status"],
  actorId: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_by: actorId };
  if (status === "suspended") {
    patch.deactivated_at = new Date().toISOString();
    patch.deactivated_by = actorId;
  }
  if (status === "archived") patch.archived_at = new Date().toISOString();
  const { error } = await supabase.from("person").update(patch).eq("id", personId);
  if (error) throw new Error(error.message);
}

/**
 * Grants a role. Goes through the database function rather than a direct
 * insert: it sets org_id, restores a previously revoked role instead of
 * duplicating it, and checks permission server-side.
 */
export async function assignRole(personId: string, roleId: string): Promise<void> {
  const { error } = await supabase.rpc("grant_role", {
    p_person_id: personId,
    p_role_id: roleId,
  });
  if (error) throw new Error(error.message);
}

/** Revokes, never deletes — that someone once held a role is worth keeping. */
export async function removeRole(personId: string, roleId: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_role", {
    p_person_id: personId,
    p_role_id: roleId,
  });
  if (error) throw new Error(error.message);
}

export async function rolesFor(personId: string): Promise<string[]> {
  const { data } = await supabase
    .from("role_assignment")
    .select("role_id")
    .eq("person_id", personId)
    .is("revoked_at", null);
  return ((data ?? []) as { role_id: string }[]).map((r) => r.role_id);
}

export async function listRubricVersions(): Promise<RubricVersionRow[]> {
  const { data, error } = await supabase
    .from("v_rubric_versions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RubricVersionRow[];
}

export async function copyRubricVersion(
  sourceId: string,
  newLabel: string,
  title?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("copy_rubric_version", {
    p_source_id: sourceId,
    p_new_label: newLabel,
    p_title: title ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function activateRubricVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc("activate_rubric_version", {
    p_version_id: versionId,
  });
  if (error) throw new Error(error.message);
}

export async function updateDraftMeta(
  versionId: string,
  patch: { title?: string; change_summary?: string; effective_date?: string | null },
): Promise<void> {
  const { error } = await supabase.from("rubric_version").update(patch).eq("id", versionId);
  if (error) throw new Error(error.message);
}

export async function listIntegrations(): Promise<Integration[]> {
  const { data, error } = await supabase.from("integration").select("*").order("provider");
  if (error) throw new Error(error.message);
  return (data ?? []) as Integration[];
}

export async function updateIntegration(
  id: string,
  patch: Partial<Pick<Integration, "status" | "config" | "last_error">> & {
    last_verified_at?: string;
    configured_by?: string;
  },
): Promise<void> {
  const { error } = await supabase.from("integration").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export interface OrgSettings {
  id: string;
  name: string;
  timezone: string;
  logo_url: string | null;
  playlist_period: "weekly" | "monthly";
  retention_months: number | null;
}

export async function getOrg(orgId: string): Promise<OrgSettings | null> {
  const { data } = await supabase
    .from("organization")
    .select("id, name, timezone, logo_url, playlist_period, retention_months")
    .eq("id", orgId)
    .maybeSingle<OrgSettings>();
  return data;
}

export async function updateOrg(
  orgId: string,
  patch: Partial<Omit<OrgSettings, "id">>,
): Promise<void> {
  const { error } = await supabase.from("organization").update(patch).eq("id", orgId);
  if (error) throw new Error(error.message);
}

export interface WorkSummary {
  evaluations: number;
  moments: number;
  playlists: number;
}

/** What removing someone would affect — shown before they confirm. */
export async function personWorkSummary(personId: string): Promise<WorkSummary> {
  const { data, error } = await supabase
    .rpc("person_work_summary", { p_person_id: personId })
    .maybeSingle<WorkSummary>();
  if (error) throw new Error(error.message);
  return data ?? { evaluations: 0, moments: 0, playlists: 0 };
}

/**
 * Removes someone. Deletes outright only if they produced nothing; otherwise
 * offboards, so their name stays on the work they did. Returns which happened.
 */
export async function removePerson(personId: string): Promise<"deleted" | "offboarded"> {
  const { data, error } = await supabase.rpc("remove_person", { p_person_id: personId });
  if (error) throw new Error(error.message);
  return data as "deleted" | "offboarded";
}
