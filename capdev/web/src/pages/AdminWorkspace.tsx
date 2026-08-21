import { useCallback, useEffect, useState } from "react";
import { SubNav } from "@/components/AppShell";
import {
  assignRole,
  getOrg,
  inviteUser,
  listIntegrations,
  listRoles,
  listUsers,
  removeRole,
  rolesFor,
  setUserStatus,
  updateOrg,
  type AdminUser,
  type Integration,
  type OrgSettings,
  type Role,
  PRIMARY_ORDER,
  personWorkSummary,
  removePerson,
  type WorkSummary,
} from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { RubricAdmin } from "@/pages/RubricAdmin";
import { EmployeeAdmin } from "@/pages/EmployeeAdmin";
import {
  DECLARED_ENVIRONMENT,
  ENVIRONMENT_COLOUR,
  ENVIRONMENT_LABEL,
  verifyEnvironment,
  type EnvironmentCheck,
} from "@/lib/environment";
import type { Session } from "@/lib/types";

type Tab = "users" | "employees" | "roles" | "rubrics" | "integrations" | "organization" | "environment";

/**
 * Administration — the governance layer.
 *
 * Written for a QA manager, not a developer. Four questions must be answerable
 * within seconds: who has access, what can they do, which rubric is active,
 * what is connected. Everything else is secondary.
 */
export function AdminWorkspace({ session }: { session: Session }): JSX.Element {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <header className="pt-8 pb-5">
        <h1 className="font-display text-3xl">Administration</h1>
        <p className="text-ink-70 text-[14px] mt-1 max-w-xl">
          People, roles, and the rubric. Change things here rarely and
          deliberately &mdash; every change is recorded.
        </p>
      </header>

      <SubNav
        tabs={[
          { key: "users" as const, label: "Users" },
          { key: "employees" as const, label: "Employees" },
            { key: "roles" as const, label: "Roles" },
          { key: "rubrics" as const, label: "Rubrics" },
          { key: "integrations" as const, label: "Integrations" },
          { key: "organization" as const, label: "Organization" },
          { key: "environment" as const, label: "Environment" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "users" && <UsersSection session={session} />}
      {tab === "roles" && <RolesSection session={session} />}
      {tab === "employees" && <EmployeeAdmin />}
      {tab === "rubrics" && <RubricAdmin />}
      {tab === "integrations" && <IntegrationsSection />}
      {tab === "organization" && <OrganizationSection session={session} />}
      {tab === "environment" && <EnvironmentSection />}
    </div>
  );
}

// ---------------------------------------------------------------- users

function UsersSection({ session }: { session: Session }): JSX.Element {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [inviting, setInviting] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AdminUser | null>(null);
  const [work, setWork] = useState<WorkSummary | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = session.permissions.includes("person.manage");

  const load = useCallback(async (): Promise<void> => {
    try {
      const [u, r] = await Promise.all([listUsers(), listRoles()]);
      setUsers(u);
      setRoles(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(): Promise<void> {
    try {
      await inviteUser({
        orgId: session.person.org_id,
        personId: session.person.id,
        email,
        displayName: name,
        roleId: roleId || undefined,
      });
      setEmail("");
      setName("");
      setRoleId("");
      setInviting(false);
      setJustAdded(name.trim());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function changeStatus(u: AdminUser, status: AdminUser["status"]): Promise<void> {
    try {
      await setUserStatus(u.id, status, session.person.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function startRemove(u: AdminUser): Promise<void> {
    setRemoving(u);
    setConfirmText("");
    setWork(null);
    setWork(await personWorkSummary(u.id));
  }

  async function confirmRemove(): Promise<void> {
    if (!removing) return;
    setBusy(true);
    try {
      const outcome = await removePerson(removing.id);
      setRemoving(null);
      setError(
        outcome === "deleted"
          ? null
          : `${removing.display_name} no longer has access. Their past work keeps their name on it.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const hasWork =
    work !== null && (work.evaluations > 0 || work.moments > 0 || work.playlists > 0);

  return (
    <div>
      <div className="flex justify-between items-start gap-4 flex-wrap mb-4">
        <p className="text-[13px] text-ink-70 max-w-xl">
          Adding someone grants access &mdash; it does not email them. Send them
          the link yourself and they sign in with Google. Only administrators and
          executives can add or remove people.
        </p>
        {canManage && (
          <button
            onClick={() => setInviting(true)}
            className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium hover:opacity-85"
          >
            Add someone
          </button>
        )}
      </div>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      {justAdded && (
        <div className="bg-card border border-rule-soft rounded px-4 py-3.5 mb-4 flex justify-between items-start gap-4">
          <p className="text-[13px] text-ink-70">
            <span className="font-semibold">{justAdded} now has access.</span> They
            won&rsquo;t get an email &mdash; send them{" "}
            <span className="font-mono text-[12.5px]">{window.location.origin}</span>{" "}
            and tell them to sign in with the Google account you used here.
          </p>
          <button
            onClick={() => setJustAdded(null)}
            className="text-[12.5px] text-ink-45 underline underline-offset-2 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {inviting && (
        <div className="bg-card border border-rule-soft rounded px-4 py-4 mb-4 grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-[12px] font-semibold mb-1.5">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vera Santos"
              className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-[12px] font-semibold mb-1.5">
              Google email
            </span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vera@atticuspress.com"
              className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-[12px] font-semibold mb-1.5">Role</span>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
            >
              <option value="">No role yet</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-3 flex gap-2">
            <button
              onClick={() => void invite()}
              disabled={!email.trim() || !name.trim()}
              className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-40"
            >
              Add them
            </button>
            <button
              onClick={() => setInviting(false)}
              className="border border-rule rounded px-3.5 py-1.5 text-[13px] hover:bg-ground-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {removing && (
        <div
          className="fixed inset-0 z-50 grid place-items-center px-4"
          style={{ background: "rgba(22,33,29,0.42)" }}
        >
          <div className="w-full max-w-md bg-card border border-rule rounded px-6 py-5">
            <h2 className="font-display text-2xl mb-2">
              Remove {removing.display_name}?
            </h2>

            {work === null ? (
              <p className="text-[13px] text-ink-45">Checking their work&hellip;</p>
            ) : hasWork ? (
              <>
                <p className="text-[13.5px] text-ink-70">
                  They will lose access immediately and permanently.
                </p>
                <p className="text-[13.5px] text-ink-70 mt-2">
                  Their work stays: {work.evaluations} evaluation
                  {work.evaluations === 1 ? "" : "s"}
                  {work.moments > 0 && `, ${work.moments} teaching moment${work.moments === 1 ? "" : "s"}`}
                  {work.playlists > 0 && `, ${work.playlists} playlist${work.playlists === 1 ? "" : "s"}`}
                  {" "}will keep their name, so the record of who did what stays true.
                </p>
                <p className="text-[12.5px] text-ink-45 mt-2">
                  This is why they can&rsquo;t be deleted outright.
                </p>
              </>
            ) : (
              <p className="text-[13.5px] text-ink-70">
                They haven&rsquo;t done any work yet, so this deletes their account
                completely. This cannot be undone.
              </p>
            )}

            <label className="block mt-4">
              <span className="block text-[12px] text-ink-70 mb-1.5">
                Type <span className="font-mono font-semibold">{removing.display_name}</span> to confirm
              </span>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
              />
            </label>

            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={() => setRemoving(null)}
                disabled={busy}
                className="border border-rule rounded px-3.5 py-2 text-[13px] hover:bg-ground-2"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmRemove()}
                disabled={busy || confirmText.trim() !== removing.display_name}
                className="bg-[#AC3A2A] text-white border border-[#AC3A2A] rounded px-3.5 py-2 text-[13px] font-medium hover:opacity-85 disabled:opacity-40"
              >
                {busy ? "Removing…" : hasWork ? "Remove access" : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}

      {users === null ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left">
                <Th>Person</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Last login</Th>
                <Th>Last raw QA</Th>
                <Th>Last calibration</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-rule-soft">
                  <td className="py-2.5 pr-4">
                    <span className="font-medium">{u.display_name}</span>
                    <span className="block text-[11.5px] text-ink-45">{u.email}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-ink-70">
                    {u.roles.length > 0 ? u.roles.join(", ") : <span className="text-[#96690A]">none</span>}
                  </td>
                  <td className="py-2.5 pr-4">
                    <StatusChip status={u.status} />
                  </td>
                  <td className="py-2.5 pr-4 text-ink-45 font-mono text-[11.5px]">
                    {u.last_login_at ? formatDate(u.last_login_at) : "never"}
                  </td>
                  <td className="py-2.5 pr-4 text-ink-45 font-mono text-[11.5px]">
                    {u.last_raw_submitted ? formatDate(u.last_raw_submitted) : "—"}
                    {u.raw_count > 0 && (
                      <span className="text-ink-45"> ({u.raw_count})</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-ink-45 font-mono text-[11.5px]">
                    {u.last_calibration ? formatDate(u.last_calibration) : "—"}
                    {u.calibration_count > 0 && (
                      <span className="text-ink-45"> ({u.calibration_count})</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    {canManage && u.id !== session.person.id && (
                      <span className="flex gap-3 justify-end">
                        {u.status === "suspended" || u.status === "offboarded" ? (
                          <button
                            onClick={() => void changeStatus(u, "active")}
                            className="text-[12.5px] underline underline-offset-2 text-ink-45 hover:text-ink"
                          >
                            Reactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => void changeStatus(u, "suspended")}
                            className="text-[12.5px] underline underline-offset-2 text-ink-45 hover:text-ink"
                          >
                            Deactivate
                          </button>
                        )}
                        <button
                          onClick={() => void startRemove(u)}
                          className="text-[12.5px] underline underline-offset-2 text-[#AC3A2A] hover:opacity-75"
                        >
                          Remove
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- roles

function RolesSection({ session }: { session: Session }): JSX.Element {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [assigned, setAssigned] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const [u, r] = await Promise.all([listUsers(), listRoles()]);
    setUsers(u.filter((x) => x.status !== "archived"));
    // Order the picker by seniority rather than alphabetically, so the list
    // reads like an org chart.
    setRoles(
      [...r].sort(
        (a, b) => PRIMARY_ORDER.indexOf(a.code) - PRIMARY_ORDER.indexOf(b.code),
      ),
    );
    const map: Record<string, string[]> = {};
    await Promise.all(
      u.map(async (person) => {
        map[person.id] = await rolesFor(person.id);
      }),
    );
    setAssigned(map);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trainerRole = roles.find((r) => r.code === "qa_trainer");
  const reviewerRole = roles.find((r) => r.code === "raw_qa_reviewer");

  /** Replaces whatever role someone held with the one chosen. */
  async function setPrimary(personId: string, roleId: string): Promise<void> {
    setBusy(personId);
    setError(null);
    try {
      const current = assigned[personId] ?? [];
      for (const held of current) {
        if (held !== roleId) await removeRole(personId, held);
      }
      if (roleId && !current.includes(roleId)) await assignRole(personId, roleId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load();
    } finally {
      setBusy(null);
    }
  }

  /** The one genuine overlap: a reviewer who also calibrates. */
  async function toggleAlsoCalibrates(personId: string, on: boolean): Promise<void> {
    if (!trainerRole) return;
    setBusy(personId);
    setError(null);
    try {
      if (on) await assignRole(personId, trainerRole.id);
      else await removeRole(personId, trainerRole.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function primaryOf(personId: string): string {
    const held = assigned[personId] ?? [];
    for (const code of PRIMARY_ORDER) {
      const role = roles.find((r) => r.code === code);
      if (role && held.includes(role.id)) return role.id;
    }
    return "";
  }

  return (
    <div>
      <p className="text-[13px] text-ink-70 max-w-xl mb-4">
        A role decides which parts of the platform someone sees. Most people have
        one.
      </p>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      <ul className="space-y-2">
        {users.map((u) => {
          const primary = primaryOf(u.id);
          const isReviewer = reviewerRole ? primary === reviewerRole.id : false;
          const alsoTrainer = trainerRole
            ? (assigned[u.id] ?? []).includes(trainerRole.id) && !!primary && primary !== trainerRole.id
            : false;

          return (
            <li
              key={u.id}
              className="bg-card border border-rule-soft rounded px-4 py-3 flex justify-between items-center gap-4 flex-wrap"
            >
              <div className="min-w-0">
                <span className="font-medium text-[14px]">{u.display_name}</span>
                <span className="block text-[11.5px] text-ink-45">{u.email}</span>
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                {isReviewer && (
                  <label className="flex items-center gap-2 text-[12.5px] text-ink-70">
                    <input
                      type="checkbox"
                      checked={alsoTrainer}
                      disabled={busy === u.id}
                      onChange={(e) => void toggleAlsoCalibrates(u.id, e.target.checked)}
                    />
                    Also calibrates
                  </label>
                )}

                <select
                  value={primary}
                  disabled={busy === u.id || u.id === session.person.id}
                  onChange={(e) => void setPrimary(u.id, e.target.value)}
                  title={
                    u.id === session.person.id
                      ? "You can't change your own role"
                      : undefined
                  }
                  className="border border-rule rounded px-2.5 py-1.5 bg-white text-[13px] disabled:opacity-50"
                >
                  <option value="">No access</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 border-t border-rule pt-4">
        <h3 className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-2">
          What each role can do
        </h3>
        <ul className="text-[13px] text-ink-70 space-y-1">
          {roles.map((r) => (
            <li key={r.id}>
              <span className="font-medium">{r.name}</span>
              {r.description && <span className="text-ink-45"> — {r.description}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- rubrics

// ---------------------------------------------------------- integrations

function IntegrationsSection(): JSX.Element {
  const [items, setItems] = useState<Integration[] | null>(null);

  useEffect(() => {
    void listIntegrations().then(setItems);
  }, []);

  return (
    <div>
      <p className="text-[13px] text-ink-70 max-w-xl mb-4">
        Outside services the platform uses. Keys are stored securely in Supabase
        and never shown here &mdash; not even to administrators.
      </p>

      {items === null ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((i) => (
            <li
              key={i.id}
              className="bg-card border border-rule-soft rounded px-4 py-3.5 flex justify-between items-start gap-4 flex-wrap"
            >
              <div>
                <span className="font-display text-lg">{i.display_name}</span>
                <p className="text-[12px] text-ink-45 mt-0.5">
                  {i.status === "connected"
                    ? `Connected${i.last_verified_at ? ` · checked ${formatDate(i.last_verified_at)}` : ""}`
                    : i.status === "error"
                      ? i.last_error ?? "Not working"
                      : i.status === "disabled"
                        ? "Turned off"
                        : "Not set up"}
                </p>
              </div>
              <span
                className={`text-[11px] border rounded-full px-2.5 py-1 ${
                  i.status === "connected"
                    ? "border-[#1F7A4D] text-[#1F7A4D]"
                    : i.status === "error"
                      ? "border-[#AC3A2A] text-[#AC3A2A]"
                      : "border-rule text-ink-45"
                }`}
              >
                {i.status === "connected"
                  ? "Connected"
                  : i.status === "error"
                    ? "Problem"
                    : i.status === "disabled"
                      ? "Off"
                      : "Not set up"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[12px] text-ink-45 mt-4 max-w-xl">
        Adding a key is still done in the Supabase dashboard under Edge Functions
        &rarr; Secrets. Connecting services from here arrives with publishing.
      </p>
    </div>
  );
}

// --------------------------------------------------------- organization

function OrganizationSection({ session }: { session: Session }): JSX.Element {
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getOrg(session.person.org_id).then(setOrg);
  }, [session.person.org_id]);

  async function save(patch: Partial<OrgSettings>): Promise<void> {
    if (!org) return;
    setOrg({ ...org, ...patch });
    try {
      await updateOrg(org.id, patch);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!org) return <p className="text-ink-45 text-sm">Loading&hellip;</p>;

  return (
    <div className="max-w-xl">
      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      <div className="bg-card border border-rule-soft rounded px-4 py-4 space-y-4">
        <label className="block">
          <span className="block text-[12px] font-semibold mb-1.5">Organization name</span>
          <input
            value={org.name}
            onChange={(e) => setOrg({ ...org, name: e.target.value })}
            onBlur={(e) => void save({ name: e.target.value })}
            className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
          />
        </label>

        <label className="block">
          <span className="block text-[12px] font-semibold mb-1.5">Time zone</span>
          <input
            value={org.timezone}
            onChange={(e) => setOrg({ ...org, timezone: e.target.value })}
            onBlur={(e) => void save({ timezone: e.target.value })}
            placeholder="Asia/Manila"
            className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
          />
        </label>

        <div>
          <span className="block text-[12px] font-semibold mb-1.5">
            Group completed reviews by
          </span>
          <div className="flex gap-2">
            {(["weekly", "monthly"] as const).map((p) => (
              <button
                key={p}
                onClick={() => void save({ playlist_period: p })}
                className={`border rounded px-3.5 py-1.5 text-[13px] capitalize ${
                  org.playlist_period === p
                    ? "bg-ink text-ground border-ink"
                    : "border-rule hover:bg-ground-2"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-ink-45 mt-1.5">
            Affects how a reviewer&rsquo;s finished work is grouped. Existing
            groups are not changed.
          </p>
        </div>
      </div>

      {saved && <p className="text-[12px] text-ink-45 mt-2">Saved.</p>}
    </div>
  );
}

// ---------------------------------------------------------- environment

/**
 * Informational only. Environment is set by the deployment, so there is
 * nothing here to change — showing it is the point.
 */
function EnvironmentSection(): JSX.Element {
  const [check, setCheck] = useState<EnvironmentCheck | null>(null);

  useEffect(() => {
    void verifyEnvironment().then(setCheck);
  }, []);

  const colour = ENVIRONMENT_COLOUR[DECLARED_ENVIRONMENT];
  const isSandbox = DECLARED_ENVIRONMENT === "sandbox";

  return (
    <div className="max-w-xl">
      <div className="bg-card border rounded px-5 py-5" style={{ borderColor: colour }}>
        <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
          Current environment
        </p>
        <p className="font-display text-3xl mt-1" style={{ color: colour }}>
          {ENVIRONMENT_LABEL[DECLARED_ENVIRONMENT]}
        </p>
        <p className="text-[13.5px] text-ink-70 mt-2">
          {isSandbox
            ? "Experimentation, training and workflow validation. Nothing here is an official record, and this database can be reset without affecting production."
            : "Live operational work. Everything here is part of the organisation's official record."}
        </p>
      </div>

      <dl className="mt-5 border-t border-rule">
        <Row label="Database" value={isSandbox ? "Sandbox project" : "Production project"} />
        <Row label="Storage" value={isSandbox ? "Sandbox bucket" : "Production bucket"} />
        <Row label="Sign-in" value={isSandbox ? "Sandbox OAuth client" : "Production OAuth client"} />
        <Row label="Transcription" value={isSandbox ? "Sandbox API key" : "Production API key"} />
        <Row
          label="Database agrees"
          value={
            check === null
              ? "checking…"
              : check.actual === null
                ? "not declared"
                : check.ok
                  ? "yes"
                  : `no — database says ${check.actual}`
          }
        />
      </dl>

      <p className="text-[12.5px] text-ink-45 mt-5">
        Environment is a property of this deployment and cannot be changed here.
        Sandbox and Production are separate installations of the same software,
        each with its own database, storage and credentials. Nothing moves
        between them automatically.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-4 py-2.5 border-b border-rule-soft">
      <dt className="text-[13px] text-ink-45">{label}</dt>
      <dd className="text-[13px] text-right">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- bits

function Th({ children }: { children?: React.ReactNode }): JSX.Element {
  return (
    <th className="py-2 pr-4 font-mono text-[10px] tracking-[0.12em] uppercase text-ink-45 font-normal">
      {children}
    </th>
  );
}

function StatusChip({ status }: { status: AdminUser["status"] }): JSX.Element {
  const tone =
    status === "active"
      ? "border-[#1F7A4D] text-[#1F7A4D]"
      : status === "invited"
        ? "border-[#96690A] text-[#96690A]"
        : "border-rule text-ink-45";
  const label =
    status === "suspended" ? "Deactivated" : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`text-[11px] border rounded-full px-2 py-0.5 ${tone}`}>{label}</span>;
}
