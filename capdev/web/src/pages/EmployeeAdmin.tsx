import { useCallback, useEffect, useMemo, useState } from "react";
import { RepresentativePicker } from "@/components/RepresentativePicker";
import {
  addRepresentative,
  listDepartments,
  listRepresentatives,
  setCallRepresentative,
  unlinkedCalls,
  updateRepresentative,
  type Representative,
} from "@/lib/performance";

/**
 * The representative directory.
 *
 * The authoritative place representative identities are created. Every other
 * feature selects from here rather than accepting a typed name, which is what
 * stops "Joe Bays", "Joe B." and "J. Bays" becoming three people with three
 * scoring histories.
 */
export function EmployeeAdmin({ canManage }: { canManage: boolean }): JSX.Element {
  const [reps, setReps] = useState<Representative[] | null>(null);
  const [orphans, setOrphans] = useState<
    { call_id: string; title: string; agent_name: string | null; completed_evaluations: number }[]
  >([]);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [r, o] = await Promise.all([listRepresentatives(), unlinkedCalls()]);
      setReps(r);
      setOrphans(o);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (reps ?? [])
      .filter((r) => showInactive || !r.is_inactive)
      .filter(
        (r) =>
          !q ||
          r.display_name.toLowerCase().includes(q) ||
          r.employee_ref.toLowerCase().includes(q) ||
          r.department.toLowerCase().includes(q),
      );
  }, [reps, search, showInactive]);

  const inactiveCount = (reps ?? []).filter((r) => r.is_inactive).length;

  return (
    <div>
      <div className="flex justify-between items-start gap-4 flex-wrap mb-4">
        <p className="text-[13px] text-ink-70 max-w-xl">
          The people whose calls are evaluated. Created here and selected
          everywhere else, so one person keeps one scoring history whatever was
          typed on a recording. A representative does not need a login.
        </p>
        {canManage && (
          <button
            onClick={() => setAdding(true)}
            className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium hover:opacity-85"
          >
            Add a representative
          </button>
        )}
      </div>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      {adding && canManage && (
        <NewRepresentative
          onDone={() => {
            setAdding(false);
            void load();
          }}
          onCancel={() => setAdding(false)}
          onError={setError}
        />
      )}

      {/* Identity resolution is deliberate: no fuzzy matching decides that two
          names are the same person. An administrator does. */}
      {canManage && orphans.length > 0 && (
        <div className="border border-[#96690A] rounded bg-card px-4 py-3.5 mb-4">
          <p className="text-[13px] font-semibold mb-1">
            Calls requiring representative assignment
            <span className="font-normal text-ink-45 ml-2">{orphans.length}</span>
          </p>
          <p className="text-[12.5px] text-ink-70 mb-2.5">
            These calls have an original representative name but are not yet
            linked to a canonical employee. Assign them once so their
            evaluations count toward the correct representative&rsquo;s history.
            The original name is kept either way.
          </p>
          <ul className="space-y-1.5">
            {orphans.slice(0, 10).map((o) => (
              <li key={o.call_id} className="flex items-center gap-3 flex-wrap">
                <span className="text-[13px] flex-1 min-w-0 truncate">
                  {o.agent_name && (
                    <span className="font-semibold">&ldquo;{o.agent_name}&rdquo;</span>
                  )}
                  <span className="text-ink-45 ml-2">{o.title}</span>
                  {o.completed_evaluations > 0 && (
                    <span className="text-ink-45 ml-2">
                      · {o.completed_evaluations} completed
                    </span>
                  )}
                </span>
                <AssignCall callId={o.call_id} onAssigned={load} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {(reps?.length ?? 0) > 0 && (
        <div className="flex gap-3 items-center flex-wrap mb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, reference or team"
            className="flex-1 min-w-56 border border-rule rounded px-2.5 py-2 bg-white text-[13.5px]"
          />
          {inactiveCount > 0 && (
            <label className="flex items-center gap-2 text-[12.5px] text-ink-45">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show {inactiveCount} inactive
            </label>
          )}
        </div>
      )}

      {reps === null ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : visible.length === 0 ? (
        <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
          <h2 className="font-display text-2xl mb-2">
            {reps.length === 0 ? "No representatives yet" : "Nothing matches that"}
          </h2>
          <p className="text-ink-70 max-w-md mx-auto">
            {reps.length === 0
              ? "Add the people whose calls you evaluate. Scoring follows the record, not the spelling of a name."
              : "Try a different name, reference or team."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => (
            <RepRow
              key={r.id}
              rep={r}
              canManage={canManage}
              onChanged={load}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NewRepresentative({
  onDone,
  onCancel,
  onError,
}: {
  onDone: () => void;
  onCancel: () => void;
  onError: (m: string) => void;
}): JSX.Element {
  const [first, setFirst] = useState("");
  const [middle, setMiddle] = useState("");
  const [last, setLast] = useState("");
  const [dept, setDept] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = [first.trim(), last.trim()].filter(Boolean).join(" ");

  async function create(): Promise<void> {
    setBusy(true);
    try {
      await addRepresentative({
        firstName: first,
        middleName: middle,
        lastName: last,
        department: dept,
        employeeRef: ref,
      });
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border border-ink rounded px-4 py-4 mb-4 max-w-3xl">
      <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mb-3">
        New representative
      </p>

      <div className="grid sm:grid-cols-3 gap-3 mb-3">
        <Field label="First name" value={first} onChange={setFirst} />
        <Field label="Middle name" hint="optional" value={middle} onChange={setMiddle} />
        <Field label="Last name" value={last} onChange={setLast} />
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <Field
          label="Employee reference"
          hint="your own ID — must be unique"
          value={ref}
          onChange={setRef}
        />
        <DepartmentField value={dept} onChange={setDept} />
      </div>

      {preview && (
        <p className="text-[13px] text-ink-70 mb-3">
          Will appear everywhere as{" "}
          <span className="font-semibold">{preview}</span>
          {ref && <span className="text-ink-45"> · {ref}</span>}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => void create()}
          disabled={!first.trim() || !last.trim() || busy}
          className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add"}
        </button>
        <button
          onClick={onCancel}
          className="border border-rule rounded px-3.5 py-1.5 text-[13px]"
        >
          Cancel
        </button>
      </div>
      <p className="text-[12px] text-ink-45 mt-2">
        No login or email is created. This is a record of someone whose work is
        evaluated, not an account.
      </p>
    </div>
  );
}

function RepRow({
  rep,
  canManage,
  onChanged,
  onError,
}: {
  rep: Representative;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState(rep.first_name);
  const [middle, setMiddle] = useState(rep.middle_name);
  const [last, setLast] = useState(rep.last_name);
  const [dept, setDept] = useState(rep.department);
  const [ref, setRef] = useState(rep.employee_ref);

  async function save(patch: Parameters<typeof updateRepresentative>[1]): Promise<void> {
    try {
      await updateRepresentative(rep.id, patch);
      setEditing(false);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <li className="bg-card border border-rule-soft rounded px-4 py-3">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div className="min-w-0">
          <span className="text-[14.5px]">
            {rep.employee_ref && (
              <span className="font-mono text-[11.5px] text-ink-45 mr-2">
                {rep.employee_ref}
              </span>
            )}
            {rep.display_name}
            {rep.is_inactive && (
              <span className="text-[11px] border border-rule text-ink-45 rounded-full px-2 py-0.5 ml-2">
                {rep.status}
              </span>
            )}
            {rep.has_login && (
              <span className="text-[11px] text-ink-45 ml-2">also a CapDev user</span>
            )}
          </span>
          <p className="text-[12px] text-ink-45 mt-0.5">
            {rep.department || "no team"} · {rep.calls} call
            {rep.calls === 1 ? "" : "s"} · {rep.completed_evaluations} completed
            evaluation{rep.completed_evaluations === 1 ? "" : "s"}
          </p>
        </div>

        {canManage && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setEditing((e) => !e)}
              className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2"
            >
              {editing ? "Close" : "Edit"}
            </button>
            {!rep.is_inactive ? (
              <button
                onClick={() => void save({ status: "offboarded" })}
                title="Completed evaluations are kept"
                className="text-[12.5px] text-ink-45 underline underline-offset-2 hover:text-ink px-1"
              >
                Deactivate
              </button>
            ) : (
              <button
                onClick={() => void save({ status: "active" })}
                className="text-[12.5px] text-ink-45 underline underline-offset-2 hover:text-ink px-1"
              >
                Reactivate
              </button>
            )}
          </div>
        )}
      </div>

      {editing && canManage && (
        <div className="mt-3 border-t border-rule-soft pt-3">
          <div className="grid sm:grid-cols-3 gap-3 mb-3">
            <Field label="First name" value={first} onChange={setFirst} />
            <Field label="Middle name" hint="optional" value={middle} onChange={setMiddle} />
            <Field label="Last name" value={last} onChange={setLast} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <Field label="Employee reference" value={ref} onChange={setRef} />
            <DepartmentField value={dept} onChange={setDept} />
          </div>
          <p className="text-[12.5px] text-ink-70 mb-2.5">
            Will appear everywhere as{" "}
            <span className="font-semibold">
              {[first.trim(), last.trim()].filter(Boolean).join(" ")}
            </span>
            {" — "}including on the {rep.completed_evaluations} completed evaluation
            {rep.completed_evaluations === 1 ? "" : "s"} already recorded.
          </p>
          <button
            onClick={() =>
              void save({
                first_name: first,
                middle_name: middle,
                last_name: last,
                department: dept,
                employee_ref: ref,
              })
            }
            className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium"
          >
            Save
          </button>
        </div>
      )}
    </li>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold mb-1">
        {label}
        {hint && <span className="font-normal text-ink-45"> — {hint}</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-rule rounded px-2.5 py-1.5 bg-white text-[13.5px]"
      />
    </label>
  );
}


/**
 * Assigning an unmatched call, department first — the same narrowing the
 * uploader gets, so the two never diverge.
 */
function AssignCall({
  callId,
  onAssigned,
}: {
  callId: string;
  onAssigned: () => Promise<void>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [repId, setRepId] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="border border-rule rounded px-3 py-1 bg-white text-[12.5px] hover:bg-ground-2 shrink-0"
      >
        Assign to&hellip;
      </button>
    );
  }

  return (
    <div className="w-full sm:w-80 border border-rule rounded bg-ground px-3 py-2.5 mt-1">
      <RepresentativePicker
        value={repId}
        onChange={(id) => {
          setRepId(id);
          if (id) {
            void setCallRepresentative(callId, id).then(() => {
              setOpen(false);
              void onAssigned();
            });
          }
        }}
      />
      <button
        onClick={() => setOpen(false)}
        className="text-[12px] text-ink-45 underline underline-offset-2 mt-1.5"
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * Department, chosen from the ones in use rather than retyped.
 *
 * A new one can still be typed — this is the first representative in Sales,
 * after all — but the existing spellings are one click away, which is what
 * stops "Production" and "production" becoming two.
 */
function DepartmentField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  const [known, setKnown] = useState<string[]>([]);

  useEffect(() => {
    void listDepartments().then((d) => setKnown(d.map((x) => x.department)));
  }, []);

  return (
    <label className="block">
      <span className="block text-[12px] font-semibold mb-1">
        Department
        <span className="font-normal text-ink-45"> — used to narrow the upload picker</span>
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list="known-departments"
        placeholder="Production"
        className="w-full border border-rule rounded px-2.5 py-1.5 bg-white text-[13.5px]"
      />
      <datalist id="known-departments">
        {known.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </label>
  );
}
