import { useEffect, useMemo, useState } from "react";
import {
  listDepartments,
  representativesIn,
  type Department,
  type Representative,
} from "@/lib/performance";

/**
 * Department, then representative.
 *
 * One list of ninety names is unusable; department narrows it to a handful
 * first. Selection only — a representative can be created in Administration
 * and nowhere else, which is what keeps one person to one identity.
 */
export function RepresentativePicker({
  value,
  onChange,
  canManagePeople = false,
  onGoToAdmin,
}: {
  value: string;
  onChange: (repId: string, displayName: string) => void;
  canManagePeople?: boolean;
  onGoToAdmin?: () => void;
}): JSX.Element {
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [department, setDepartment] = useState("");
  const [reps, setReps] = useState<Representative[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void listDepartments().then((d) => {
      setDepartments(d);
      // One department is not a choice worth making.
      if (d.length === 1 && d[0]) setDepartment(d[0].department);
    });
  }, []);

  useEffect(() => {
    if (!department) {
      setReps([]);
      return;
    }
    setLoading(true);
    void representativesIn(department).then((r) => {
      setReps(r);
      setLoading(false);
    });
  }, [department]);

  const chosen = reps.find((r) => r.id === value);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reps;
    return reps.filter(
      (r) =>
        r.display_name.toLowerCase().includes(q) ||
        r.employee_ref.toLowerCase().includes(q),
    );
  }, [reps, search]);

  if (departments === null) {
    return <p className="text-[12.5px] text-ink-45">Loading representatives&hellip;</p>;
  }

  if (departments.length === 0) {
    return (
      <div className="border border-rule rounded bg-ground px-3 py-2.5">
        <p className="text-[12.5px] text-ink-70">
          No representatives have been set up yet.
        </p>
        {canManagePeople && onGoToAdmin ? (
          <button
            type="button"
            onClick={onGoToAdmin}
            className="text-[12.5px] text-accent underline underline-offset-2 mt-1"
          >
            Add representatives in Administration
          </button>
        ) : (
          <p className="text-[12px] text-ink-45 mt-1">
            Ask an administrator to add them under Administration &rarr;
            Representatives.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="block text-[11.5px] text-ink-45 mb-1">Department</span>
        <select
          value={department}
          onChange={(e) => {
            setDepartment(e.target.value);
            setSearch("");
            onChange("", "");
          }}
          className="w-full border border-rule rounded px-2.5 py-2 bg-white text-[13.5px]"
        >
          <option value="">Choose a department&hellip;</option>
          {departments.map((d) => (
            <option key={d.department} value={d.department}>
              {d.department}
              {` — ${d.active_representatives}`}
            </option>
          ))}
        </select>
      </label>

      {department && (
        <div>
          <span className="block text-[11.5px] text-ink-45 mb-1">Representative</span>

          {chosen ? (
            <div className="flex items-center gap-2.5 border border-rule rounded bg-white px-2.5 py-2">
              <span className="text-[13.5px] flex-1 min-w-0 truncate">
                {chosen.display_name}
                {chosen.employee_ref && (
                  <span className="font-mono text-[11px] text-ink-45 ml-2">
                    {chosen.employee_ref}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => {
                  onChange("", "");
                  setSearch("");
                }}
                className="text-[12px] text-ink-45 underline underline-offset-2 hover:text-ink shrink-0"
              >
                change
              </button>
            </div>
          ) : loading ? (
            <p className="text-[12.5px] text-ink-45">Loading&hellip;</p>
          ) : reps.length === 0 ? (
            <p className="text-[12.5px] text-ink-45">
              No active representatives in {department}.
            </p>
          ) : (
            <>
              {/* Searching only earns its place once the list is long enough
                  to need it. */}
              {reps.length > 8 && (
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or reference"
                  className="w-full border border-rule rounded px-2.5 py-2 bg-white text-[13.5px] mb-1.5"
                />
              )}
              <ul className="border border-rule rounded bg-white max-h-48 overflow-auto divide-y divide-rule-soft">
                {visible.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => onChange(r.id, r.display_name)}
                      className="w-full text-left px-2.5 py-1.5 text-[13.5px] hover:bg-ground"
                    >
                      {r.display_name}
                      {r.employee_ref && (
                        <span className="font-mono text-[11px] text-ink-45 ml-2">
                          {r.employee_ref}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                {visible.length === 0 && (
                  <li className="px-2.5 py-2 text-[12.5px] text-ink-45">
                    Nothing matches that in {department}.
                  </li>
                )}
              </ul>
            </>
          )}

          {/* No inline creation, deliberately: a second creation form is how
              one person becomes three. */}
          <p className="text-[11.5px] text-ink-45 mt-1.5">
            Can&rsquo;t find them?{" "}
            {canManagePeople && onGoToAdmin ? (
              <button
                type="button"
                onClick={onGoToAdmin}
                className="text-accent underline underline-offset-2"
              >
                Add a representative
              </button>
            ) : (
              "Ask an administrator to add them to the directory."
            )}
          </p>
        </div>
      )}
    </div>
  );
}
