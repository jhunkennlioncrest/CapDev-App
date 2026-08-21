import { useCallback, useEffect, useState } from "react";
import {
  addRepresentative,
  listRepresentatives,
  listRepPerformance,
  unlinkedCalls,
  updateRepresentative,
  setCallRepresentative,
  type Representative,
} from "@/lib/performance";

/**
 * Canonical representative records.
 *
 * These are people whose calls are evaluated. Most have no CapDev login and
 * never will — an account and an evaluated employee are different things that
 * happen to share the same person record.
 */
export function EmployeeAdmin({ canManage }: { canManage: boolean }): JSX.Element {
  const [reps, setReps] = useState<Representative[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [orphans, setOrphans] = useState<
    { call_id: string; title: string; agent_name: string | null; completed_evaluations: number }[]
  >([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [dept, setDept] = useState("");
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [r, perf, o] = await Promise.all([
        listRepresentatives(),
        listRepPerformance(),
        unlinkedCalls(),
      ]);
      setReps(r);
      const tally: Record<string, number> = {};
      for (const p of perf) {
        tally[p.representative_id] = (tally[p.representative_id] ?? 0) + p.evaluations;
      }
      setCounts(tally);
      setOrphans(o);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(): Promise<void> {
    try {
      await addRepresentative({ displayName: name, department: dept, employeeRef: ref });
      setName("");
      setDept("");
      setRef("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="flex justify-between items-start gap-4 flex-wrap mb-4">
        <p className="text-[13px] text-ink-70 max-w-xl">
          People whose calls are evaluated. They do not need a login &mdash; most
          representatives never sign in to CapDev.
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

      {adding && (
        <div className="bg-card border border-rule-soft rounded px-4 py-3.5 mb-4 max-w-2xl">
          <div className="grid sm:grid-cols-3 gap-3 mb-2.5">
            <Field label="Full name" value={name} onChange={setName} />
            <Field label="Team or department" value={dept} onChange={setDept} />
            <Field
              label="Employee ID"
              hint="if you have one"
              value={ref}
              onChange={setRef}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void create()}
              disabled={!name.trim()}
              className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-40"
            >
              Add
            </button>
            <button
              onClick={() => setAdding(false)}
              className="border border-rule rounded px-3.5 py-1.5 text-[13px]"
            >
              Cancel
            </button>
          </div>
          <p className="text-[12px] text-ink-45 mt-2">
            If this name already belongs to someone in the organisation, they
            become a representative rather than a second record.
          </p>
        </div>
      )}

      {/* Work that counts for nobody, surfaced rather than left to rot. */}
      {canManage && orphans.length > 0 && (
        <div className="border border-[#96690A] rounded bg-card px-4 py-3.5 mb-4">
          <p className="text-[13px] font-semibold mb-1.5">
            {orphans.length} call{orphans.length === 1 ? "" : "s"} not linked to a
            representative
          </p>
          <p className="text-[12.5px] text-ink-70 mb-2">
            These have a typed name but no canonical identity, so their
            evaluations count towards nobody.
          </p>
          <ul className="space-y-1">
            {orphans.slice(0, 6).map((o) => (
              <li key={o.call_id} className="flex items-center gap-3 flex-wrap">
                <span className="text-[13px] flex-1 min-w-0 truncate">
                  {o.title}
                  {o.agent_name && (
                    <span className="text-ink-45 ml-2">typed as &ldquo;{o.agent_name}&rdquo;</span>
                  )}
                  {o.completed_evaluations > 0 && (
                    <span className="text-ink-45 ml-2">
                      · {o.completed_evaluations} completed
                    </span>
                  )}
                </span>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      void setCallRepresentative(o.call_id, e.target.value).then(load);
                    }
                  }}
                  className="border border-rule rounded px-2 py-1 bg-white text-[12.5px]"
                >
                  <option value="">Link to…</option>
                  {(reps ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.display_name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reps === null ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : reps.length === 0 ? (
        <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
          <h2 className="font-display text-2xl mb-2">No representatives yet</h2>
          <p className="text-ink-70 max-w-md mx-auto">
            Add the people whose calls you evaluate. Scoring follows the record,
            not the spelling of a name.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {reps.map((r) => (
            <RepRow
              key={r.id}
              rep={r}
              canManage={canManage}
              evaluations={counts[r.id] ?? 0}
              onChanged={load}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RepRow({
  rep,
  evaluations,
  onChanged,
  onError,
  canManage,
}: {
  canManage: boolean;
  rep: Representative;
  evaluations: number;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(rep.display_name);
  const [dept, setDept] = useState(rep.department);
  const [ref, setRef] = useState(rep.employee_ref);

  const inactive = rep.status !== "active" || rep.archived_at !== null;

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
            {rep.display_name}
            {inactive && (
              <span className="text-[11px] border border-rule text-ink-45 rounded-full px-2 py-0.5 ml-2">
                {rep.status}
              </span>
            )}
            {rep.has_login && (
              <span className="text-[11px] text-ink-45 ml-2">also a CapDev user</span>
            )}
          </span>
          <p className="text-[12px] text-ink-45 mt-0.5">
            {rep.department || "no department"}
            {rep.employee_ref && ` · ${rep.employee_ref}`}
            {" · "}
            {evaluations} completed evaluation{evaluations === 1 ? "" : "s"}
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
          {!inactive ? (
            <button
              onClick={() => void save({ status: "offboarded" })}
              title="Their completed evaluations are kept"
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

      {editing && (
        <div className="mt-3 border-t border-rule-soft pt-3">
          <div className="grid sm:grid-cols-3 gap-3 mb-2.5">
            <Field label="Full name" value={name} onChange={setName} />
            <Field label="Team or department" value={dept} onChange={setDept} />
            <Field label="Employee ID" value={ref} onChange={setRef} />
          </div>
          <button
            onClick={() =>
              void save({ display_name: name, department: dept, employee_ref: ref })
            }
            className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium"
          >
            Save
          </button>
          {inactive && (
            <p className="text-[12px] text-ink-45 mt-2">
              Deactivating keeps every completed evaluation. Historical records
              continue to show this person.
            </p>
          )}
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
