import { useEffect, useRef, useState } from "react";
import { listRepresentatives, setCallRepresentative, type Representative } from "@/lib/performance";
import {
  ACCEPTED_EXTENSIONS,
  uploadCall,
  validateFile,
  type UploadStage,
} from "@/lib/calls";
import { formatBytes, readAudioDuration } from "@/lib/format";
import type { Session } from "@/lib/types";

interface Props {
  session: Session;
  onClose: () => void;
  onUploaded: () => void;
}

export function UploadDialog({ session, onClose, onUploaded }: Props): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [agentName, setAgentName] = useState("");
  // The canonical identity. agentName is kept as the text recorded, so calls
  // uploaded before representatives existed still show what was typed.
  const [repId, setRepId] = useState("");
  const [repSearch, setRepSearch] = useState("");
  const [reps, setReps] = useState<Representative[]>([]);

  const matches = reps.filter((r) => {
    const q = repSearch.trim().toLowerCase();
    if (!q) return false;
    return (
      r.display_name.toLowerCase().includes(q) ||
      r.employee_ref.toLowerCase().includes(q) ||
      r.department.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    void listRepresentatives().then((all) =>
      setReps(all.filter((r) => !r.is_inactive)),
    );
  }, []);
  const [customerRef, setCustomerRef] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<UploadStage>({ stage: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = stage.stage !== "idle" && stage.stage !== "error";

  async function accept(chosen: File): Promise<void> {
    const problem = validateFile(chosen);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setFile(chosen);
    if (!title) setTitle(chosen.name.replace(/\.[^.]+$/, ""));
    setDurationMs(await readAudioDuration(chosen));
  }

  async function submit(): Promise<void> {
    if (!file) {
      setError("Choose a recording first.");
      return;
    }
    setError(null);
    try {
      const newCallId = await uploadCall(
        { file, title, agentName, customerRef, occurredAt, durationMs },
        session.person.org_id,
        session.person.id,
        setStage,
      );

      // The canonical link, so scoring follows the person rather than the
      // spelling of their name on this particular call.
      if (repId) await setCallRepresentative(newCallId, repId);

      // Transcription is NOT started here. It costs money per recording, so it
      // is a deliberate press on the call page rather than a side effect of
      // uploading — a mistaken upload should never incur a charge.
      onUploaded();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStage({ stage: "error", message });
      setError(message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4"
         style={{ background: "rgba(22,33,29,0.42)" }}>
      <div className="w-full max-w-xl bg-card border border-rule rounded max-h-[88vh] overflow-auto">
        <div className="px-6 pt-5 pb-4 border-b border-rule-soft flex justify-between items-start gap-4">
          <h2 className="font-display text-2xl">Upload a recording</h2>
          <button onClick={onClose} disabled={busy} aria-label="Close"
                  className="border border-rule rounded w-8 h-8 text-ink-70 hover:bg-ground-2 disabled:opacity-40">
            ×
          </button>
        </div>

        <div className="px-6 py-5">
          {error && <p className="text-[13px] text-[#AC3A2A] mb-4">{error}</p>}

          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dropped = e.dataTransfer.files[0];
              if (dropped) void accept(dropped);
            }}
            onClick={() => inputRef.current?.click()}
            className={`border border-dashed rounded px-6 py-10 text-center cursor-pointer transition-colors
                        ${dragging ? "border-accent bg-ground-2" : "border-rule bg-ground"}`}
          >
            {file ? (
              <>
                <p className="font-display text-lg">{file.name}</p>
                <p className="text-[13px] text-ink-45 mt-1 font-mono">
                  {formatBytes(file.size)}
                  {durationMs !== null && ` · ${Math.round(durationMs / 60000)} min`}
                </p>
                <p className="text-[12px] text-ink-45 mt-3">Click to choose a different file</p>
              </>
            ) : (
              <>
                <p className="text-ink-70">Drop an audio file here, or click to choose</p>
                <p className="text-[12px] text-ink-45 mt-2">MP3, WAV, M4A or MP4 · up to 500 MB</p>
              </>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            className="hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) void accept(chosen);
            }}
          />

          <div className="mt-5 space-y-4">
            <Field label="What was this call about?"
                   hint="— how a colleague would search for it">
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                     placeholder="Refund threat after proof approval" className={inputClass} />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Representative">
                {reps.length > 0 ? (
                  <>
                    {/* Chosen from the directory, never typed. A new identity
                        can only be created in Administration, which is what
                        stops one person becoming three. */}
                    <input
                      value={repSearch}
                      onChange={(e) => {
                        setRepSearch(e.target.value);
                        setRepId("");
                      }}
                      placeholder="Search by name, reference or team"
                      className={inputClass}
                      list="representative-options"
                    />
                    <datalist id="representative-options">
                      {reps.map((r) => (
                        <option
                          key={r.id}
                          value={`${r.display_name}${r.employee_ref ? ` (${r.employee_ref})` : ""}`}
                        />
                      ))}
                    </datalist>
                    {matches.length > 0 && !repId && repSearch.trim() !== "" && (
                      <ul className="mt-1 border border-rule rounded bg-white max-h-40 overflow-auto">
                        {matches.slice(0, 6).map((r) => (
                          <li key={r.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setRepId(r.id);
                                setAgentName(r.display_name);
                                setRepSearch(r.display_name);
                              }}
                              className="w-full text-left px-2.5 py-1.5 text-[13px] hover:bg-ground"
                            >
                              {r.display_name}
                              {r.employee_ref && (
                                <span className="font-mono text-[11px] text-ink-45 ml-2">
                                  {r.employee_ref}
                                </span>
                              )}
                              {r.department && (
                                <span className="text-[11.5px] text-ink-45 ml-2">
                                  {r.department}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {repId && (
                      <span className="block text-[11.5px] text-[#1F7A4D] mt-1">
                        &#10003; {agentName}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="block text-[12.5px] text-ink-45">
                    No representatives yet. An administrator adds them in
                    Administration &rarr; Representatives, so scoring follows the
                    person rather than the spelling of a name.
                  </span>
                )}
              </Field>
              <Field label="Author or account reference">
                <input value={customerRef} onChange={(e) => setCustomerRef(e.target.value)}
                       placeholder="AUT-2291" className={inputClass} />
              </Field>
            </div>

            <Field label="When did the call happen?" hint="— optional">
              <input type="datetime-local" value={occurredAt}
                     onChange={(e) => setOccurredAt(e.target.value)} className={inputClass} />
            </Field>
          </div>
        </div>

        <div className="px-6 pb-5 pt-1 flex justify-between items-center gap-3">
          <span className="text-[12px] text-ink-45 font-mono">{stageLabel(stage)}</span>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={busy}
                    className="border border-rule rounded px-3.5 py-2 text-sm hover:bg-ground-2 disabled:opacity-40">
              Cancel
            </button>
            <button onClick={() => void submit()} disabled={busy || !file}
                    className="bg-ink text-ground border border-ink rounded px-3.5 py-2 text-sm font-medium
                               hover:opacity-85 disabled:opacity-40">
              {busy ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full border border-rule rounded px-2.5 py-2 bg-white text-ink text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-0";

function Field({ label, hint, children }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold mb-1.5">
        {label}
        {hint && <span className="font-normal text-ink-45"> {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function stageLabel(stage: UploadStage): string {
  switch (stage.stage) {
    case "reading": return "Reading file…";
    case "uploading": return "Uploading…";
    case "recording": return "Saving…";
    case "transcribing": return "Generating transcript…";
    case "done": return "Done";
    case "error": return "Failed";
    default: return "";
  }
}
