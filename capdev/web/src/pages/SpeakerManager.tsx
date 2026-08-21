import { useCallback, useEffect, useState } from "react";
import { listRepresentatives, type Representative } from "@/lib/performance";
import {
  getSpeakers,
  nameSpeaker,
  SUGGESTED_ROLES,
  type SpeakerMap,
  type SpeakerRow,
} from "@/lib/speakers";

/**
 * Names the people in a transcript, once each.
 *
 * Sits above the transcript because it is worth doing before reading: a named
 * transcript is easier to follow, and anything quoted from it afterwards
 * carries the names into moments, case studies and articles.
 */
export function SpeakerManager({
  transcriptId,
  onChanged,
}: {
  transcriptId: string;
  onChanged: (speakers: SpeakerMap) => void;
}): JSX.Element | null {
  const [rows, setRows] = useState<SpeakerRow[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRows(await getSpeakers(transcriptId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [transcriptId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!rows || rows.length === 0) return null;

  const named = rows.filter((r) => r.name || r.role).length;

  return (
    <div className="bg-card border border-rule-soft rounded px-4 py-3 mb-3">
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
            Speakers
          </p>
          {!open && (
            <p className="text-[13px] mt-1">
              {rows.map((r, i) => (
                <span key={r.label}>
                  {i > 0 && <span className="text-ink-45"> &middot; </span>}
                  <span className={r.name || r.role ? "" : "text-ink-45"}>
                    {r.display_name}
                  </span>
                </span>
              ))}
            </p>
          )}
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2 shrink-0"
        >
          {open ? "Done" : named === 0 ? "Name the speakers" : "Edit"}
        </button>
      </div>

      {error && <p className="text-[12.5px] text-[#AC3A2A] mt-2">{error}</p>}

      {open && (
        <div className="mt-3 space-y-2">
          {rows.map((row) =>
            editing === row.label ? (
              <SpeakerEditor
                key={row.label}
                row={row}
                transcriptId={transcriptId}
                onDone={async (map) => {
                  setEditing(null);
                  onChanged(map);
                  await load();
                }}
                onCancel={() => setEditing(null)}
                onError={setError}
              />
            ) : (
              <div
                key={row.label}
                className="flex justify-between items-center gap-3 flex-wrap border-b border-rule-soft pb-2 last:border-0"
              >
                <p className="text-[13.5px] min-w-0">
                  <span className="font-mono text-[11.5px] text-ink-45 mr-2">
                    {row.label}
                  </span>
                  {row.name || row.role ? (
                    <span>
                      {row.role && (
                        <span className="text-ink-45">{row.role} &mdash; </span>
                      )}
                      <span className="font-semibold">{row.name ?? row.role}</span>
                    </span>
                  ) : (
                    <span className="text-ink-45">not named</span>
                  )}
                  <span className="text-[11.5px] text-ink-45 ml-2">
                    {row.segment_count} line{row.segment_count === 1 ? "" : "s"}
                  </span>
                </p>
                <button
                  onClick={() => setEditing(row.label)}
                  className="text-[12.5px] text-ink-45 underline underline-offset-2 hover:text-ink shrink-0"
                >
                  {row.name || row.role ? "Change" : "Name"}
                </button>
              </div>
            ),
          )}
          <p className="text-[12px] text-ink-45 pt-1">
            Naming a speaker updates every line they spoke. The transcript
            itself is not changed.
          </p>
        </div>
      )}
    </div>
  );
}

function SpeakerEditor({
  row,
  transcriptId,
  onDone,
  onCancel,
  onError,
}: {
  row: SpeakerRow;
  transcriptId: string;
  onDone: (map: SpeakerMap) => Promise<void>;
  onCancel: () => void;
  onError: (m: string) => void;
}): JSX.Element {
  const [name, setName] = useState(row.name ?? "");
  const [role, setRole] = useState(row.role ?? "");
  const [repId, setRepId] = useState(row.representative_id ?? "");
  const [reps, setReps] = useState<Representative[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listRepresentatives().then((all) => setReps(all.filter((r) => !r.is_inactive)));
  }, []);

  async function save(clear = false): Promise<void> {
    setBusy(true);
    try {
      const map = await nameSpeaker({
        transcriptId,
        label: row.label,
        // Identifying a speaker as a representative takes the name from the
        // directory, so correcting it there corrects every transcript.
        name: clear || repId ? null : name,
        role: clear ? null : role,
        representativeId: clear ? null : repId || null,
      });
      await onDone(map);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-rule rounded bg-ground px-3 py-3">
      <p className="font-mono text-[11.5px] text-ink-45 mb-2">{row.label}</p>

      {reps.length > 0 && (
        <label className="block mb-2.5">
          <span className="block text-[12px] font-semibold mb-1">
            Is this one of our representatives?
            <span className="font-normal text-ink-45"> — keeps the name in step with the directory</span>
          </span>
          <select
            value={repId}
            onChange={(e) => {
              setRepId(e.target.value);
              const chosen = reps.find((r) => r.id === e.target.value);
              if (chosen) {
                setName(chosen.display_name);
                setRole("Representative");
              }
            }}
            className="w-full border border-rule rounded px-2.5 py-1.5 bg-white text-[13.5px]"
          >
            <option value="">No — someone else</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.display_name}
                {r.employee_ref ? ` (${r.employee_ref})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid sm:grid-cols-2 gap-2.5">
        <label className="block">
          <span className="block text-[12px] font-semibold mb-1">Name</span>
          <input
            value={name}
            disabled={Boolean(repId)}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            placeholder="John Smith"
            className="w-full border border-rule rounded px-2.5 py-1.5 bg-white text-[13.5px]"
          />
        </label>
        <label className="block">
          <span className="block text-[12px] font-semibold mb-1">
            Role <span className="font-normal text-ink-45">optional</span>
          </span>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            placeholder="Representative"
            list={`roles-${row.label}`}
            className="w-full border border-rule rounded px-2.5 py-1.5 bg-white text-[13.5px]"
          />
          <datalist id={`roles-${row.label}`}>
            {SUGGESTED_ROLES.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
      </div>

      <div className="flex gap-2 mt-2.5 flex-wrap items-center">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="border border-rule rounded px-3.5 py-1.5 text-[12.5px]"
        >
          Cancel
        </button>
        {(row.name || row.role) && (
          <button
            onClick={() => void save(true)}
            className="text-[12px] text-ink-45 underline underline-offset-2 hover:text-ink ml-auto"
          >
            Remove name
          </button>
        )}
      </div>
    </div>
  );
}
