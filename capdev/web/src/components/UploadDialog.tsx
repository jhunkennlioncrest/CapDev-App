import { useRef, useState } from "react";
import {
  ACCEPTED_EXTENSIONS,
  uploadCall,
  validateFile,
  type UploadStage,
} from "@/lib/calls";
import { formatBytes, readAudioDuration } from "@/lib/format";
import { setCallRepresentative } from "@/lib/performance";
import { setDirectPath } from "@/lib/workflow";
import { RepresentativePicker } from "@/components/RepresentativePicker";
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
  const [repId, setRepId] = useState("");
  // Skipping Raw QA is a calibration decision, so it is offered on the
  // capability rather than on a role name. Uploading is a separate capability
  // again: a trainer may upload a call and still want an independent review.
  const canCalibrate = session.permissions.includes("calibration.perform");
  const [evaluateMyself, setEvaluateMyself] = useState(false);
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

      // agent_name keeps what was recorded for this call; representative_id is
      // who the organisation says that person is. Scoring follows the latter.
      if (repId) await setCallRepresentative(newCallId, repId);

      // Recorded as a decision on the call. No raw observation is invented to
      // satisfy the workflow.
      if (evaluateMyself && canCalibrate) await setDirectPath(newCallId);

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

            <Field label="Representative">
              <RepresentativePicker
                value={repId}
                onChange={(id, name) => {
                  setRepId(id);
                  setAgentName(name);
                }}
                canManagePeople={session.permissions.includes("person.manage")}
              />
            </Field>

            <Field label="Author or account reference">
              <input value={customerRef} onChange={(e) => setCustomerRef(e.target.value)}
                     placeholder="AUT-2291" className={inputClass} />
            </Field>

            {canCalibrate && (
              <label className="flex items-start gap-2.5 border border-rule rounded bg-ground px-3 py-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={evaluateMyself}
                  onChange={(e) => setEvaluateMyself(e.target.checked)}
                  className="mt-0.5"
                  disabled={busy}
                />
                <span>
                  <span className="block text-[13.5px]">
                    I will evaluate this call myself
                  </span>
                  <span className="block text-[12px] text-ink-45 mt-0.5">
                    Skips Raw QA and sends this call directly to Calibration.
                    Leave it unticked if you want an independent review first.
                  </span>
                </span>
              </label>
            )}

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
