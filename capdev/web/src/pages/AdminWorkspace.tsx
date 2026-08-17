import { useCallback, useEffect, useState } from "react";
import { SubNav } from "@/components/AppShell";
import {
  activateRubricVersion,
  assignRole,
  copyRubricVersion,
  getOrg,
  inviteUser,
  listIntegrations,
  listRoles,
  listRubricVersions,
  listUsers,
  removeRole,
  rolesFor,
  setUserStatus,
  updateOrg,
  type AdminUser,
  type Integration,
  type OrgSettings,
  type Role,
  type RubricVersionRow,
} from "@/lib/admin";
import { formatDate } from "@/lib/format";
import type { Session } from "@/lib/types";

type Tab = "users" | "roles" | "rubrics" | "integrations" | "organization";

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
          { key: "roles" as const, label: "Roles" },
          { key: "rubrics" as const, label: "Rubrics" },
          { key: "integrations" as const, label: "Integrations" },
          { key: "organization" as const, label: "Organization" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "users" && <UsersSection session={session} />}
      {tab === "roles" && <RolesSection session={session} />}
      {tab === "rubrics" && <RubricsSection />}
      {tab === "integrations" && <IntegrationsSection />}
      {tab === "organization" && <OrganizationSection session={session} />}
    </div>
  );
}

// ---------------------------------------------------------------- users

function UsersSection({ session }: { session: Session }): JSX.Element {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <div className="flex justify-between items-start gap-4 flex-wrap mb-4">
        <p className="text-[13px] text-ink-70 max-w-xl">
          Anyone invited here can sign in with their Google account. People are
          never deleted &mdash; their past work keeps their name on it.
        </p>
        <button
          onClick={() => setInviting(true)}
          className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium hover:opacity-85"
        >
          Invite someone
        </button>
      </div>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

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
              Send invitation
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
                    {u.id !== session.person.id &&
                      (u.status === "suspended" || u.status === "archived" ? (
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
                      ))}
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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const [u, r] = await Promise.all([listUsers(), listRoles()]);
    setUsers(u.filter((x) => x.status !== "archived"));
    setRoles(r);
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

  async function toggle(personId: string, roleId: string, on: boolean): Promise<void> {
    try {
      if (on) await assignRole(personId, roleId, session.person.id);
      else await removeRole(personId, roleId);
      await load();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <p className="text-[13px] text-ink-70 max-w-xl mb-4">
        A role decides which workspaces someone sees. Somebody can hold more than
        one &mdash; a small team often has one person doing both jobs.
      </p>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-rule text-left">
              <Th>Person</Th>
              {roles.map((r) => (
                <Th key={r.id}>{r.name}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-rule-soft">
                <td className="py-2.5 pr-4">
                  <span className="font-medium">{u.display_name}</span>
                  <span className="block text-[11.5px] text-ink-45">{u.email}</span>
                </td>
                {roles.map((r) => (
                  <td key={r.id} className="py-2.5 pr-4">
                    <input
                      type="checkbox"
                      checked={(assigned[u.id] ?? []).includes(r.id)}
                      onChange={(e) => void toggle(u.id, r.id, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- rubrics

function RubricsSection(): JSX.Element {
  const [versions, setVersions] = useState<RubricVersionRow[] | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setVersions(await listRubricVersions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function copy(sourceId: string): Promise<void> {
    setBusy(true);
    try {
      await copyRubricVersion(sourceId, label);
      setLabel("");
      setCopying(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: string): Promise<void> {
    setBusy(true);
    try {
      await activateRubricVersion(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const active = (versions ?? []).find((v) => v.status === "active");

  return (
    <div>
      <p className="text-[13px] text-ink-70 max-w-xl mb-4">
        To change the rubric, copy the active version, edit the copy, then
        activate it. The old version is kept &mdash; every past evaluation stays
        measured against the rubric it was scored with.
      </p>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      {active && (
        <div className="bg-card border border-ink rounded px-4 py-3.5 mb-4">
          <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
            Currently active
          </p>
          <div className="flex justify-between items-baseline gap-4 flex-wrap mt-1">
            <div>
              <span className="font-display text-xl">
                {active.title} &middot; v{active.version_label}
              </span>
              <p className="text-[12px] text-ink-45 mt-0.5">
                {active.criterion_count} criteria &middot; {active.evaluations_using}{" "}
                evaluation{active.evaluations_using === 1 ? "" : "s"} scored against it
                {active.activated_at && ` · since ${formatDate(active.activated_at)}`}
              </p>
            </div>
            {copying === active.id ? (
              <div className="flex gap-2 items-center">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="1.1"
                  className="w-20 border border-rule rounded px-2 py-1.5 bg-white text-[13px]"
                />
                <button
                  onClick={() => void copy(active.id)}
                  disabled={!label.trim() || busy}
                  className="bg-ink text-ground border border-ink rounded px-3 py-1.5 text-[13px] disabled:opacity-40"
                >
                  Create draft
                </button>
                <button
                  onClick={() => setCopying(null)}
                  className="border border-rule rounded px-3 py-1.5 text-[13px]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCopying(active.id)}
                className="border border-rule rounded px-3.5 py-1.5 text-[13px] hover:bg-ground-2"
              >
                Create a new version from this
              </button>
            )}
          </div>
        </div>
      )}

      {versions === null ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : (
        <ul className="space-y-2">
          {versions
            .filter((v) => v.status !== "active")
            .map((v) => (
              <li
                key={v.id}
                className="bg-card border border-rule-soft rounded px-4 py-3 flex justify-between items-center gap-4 flex-wrap"
              >
                <div className="min-w-0">
                  <span className="font-display text-base">
                    {v.title} &middot; v{v.version_label}
                  </span>
                  <span
                    className={`text-[11px] border rounded-full px-2 py-0.5 ml-2 ${
                      v.status === "draft"
                        ? "border-[#96690A] text-[#96690A]"
                        : "border-rule text-ink-45"
                    }`}
                  >
                    {v.status}
                  </span>
                  <p className="text-[12px] text-ink-45 mt-0.5">
                    {v.criterion_count} criteria
                    {v.created_by_name && ` · by ${v.created_by_name}`}
                    {v.evaluations_using > 0 &&
                      ` · ${v.evaluations_using} evaluation${v.evaluations_using === 1 ? "" : "s"} used it`}
                    {v.archived_at && ` · archived ${formatDate(v.archived_at)}`}
                  </p>
                </div>
                {v.status === "draft" && (
                  <button
                    onClick={() => void activate(v.id)}
                    disabled={busy}
                    className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium hover:opacity-85 disabled:opacity-40"
                  >
                    Make this the active rubric
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}

      <p className="text-[12px] text-ink-45 mt-4 max-w-xl">
        Editing the criteria inside a draft is not yet possible here &mdash; that
        screen comes next. A draft copied from the active version already has all
        its criteria.
      </p>
    </div>
  );
}

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
