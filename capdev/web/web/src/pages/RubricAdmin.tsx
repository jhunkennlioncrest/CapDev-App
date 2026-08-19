import { useCallback, useEffect, useMemo, useState } from "react";
import {
  activateVersion,
  addCriterion,
  compareVersions,
  copyVersion,
  createDraftFromImport,
  deleteDraft,
  getCriteria,
  getSections,
  listVersions,
  parseDelimited,
  removeCriterion,
  returnToDraft,
  submitForReview,
  updateCriterion,
  updateVersionMeta,
  type FlatCriterion,
  type ParsedCriterion,
  type RubricVersionRow,
  type SectionRow,
  type VersionStatus,
} from "@/lib/rubricAdmin";
import { formatDate } from "@/lib/format";

type View =
  | { name: "list" }
  | { name: "edit"; id: string }
  | { name: "preview"; id: string }
  | { name: "compare" }
  | { name: "import" };

/**
 * Rubric administration.
 *
 * The lifecycle is deliberately visible: draft, review, active, archived. A
 * version under review is frozen so executives compare a stable document —
 * enforced in the database, not just hidden in the interface.
 */
export function RubricAdmin(): JSX.Element {
  const [view, setView] = useState<View>({ name: "list" });
  const [versions, setVersions] = useState<RubricVersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setVersions(await listVersions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (view.name === "edit") {
    return (
      <VersionEditor
        versionId={view.id}
        onBack={() => {
          setView({ name: "list" });
          void load();
        }}
      />
    );
  }
  if (view.name === "preview") {
    return <VersionPreview versionId={view.id} onBack={() => setView({ name: "list" })} />;
  }
  if (view.name === "compare") {
    return (
      <CompareVersions
        versions={versions ?? []}
        onBack={() => setView({ name: "list" })}
      />
    );
  }
  if (view.name === "import") {
    return (
      <ImportRubric
        onBack={() => setView({ name: "list" })}
        onImported={(id) => {
          void load();
          setView({ name: "edit", id });
        }}
      />
    );
  }

  const active = (versions ?? []).find((v) => v.status === "active");
  const others = (versions ?? []).filter((v) => v.status !== "active");

  return (
    <div>
      <div className="flex justify-between items-start gap-4 flex-wrap mb-4">
        <p className="text-[13px] text-ink-70 max-w-xl">
          One version is in use at a time. To change the rubric, make a new
          version, review it, then activate it &mdash; the old one is kept, so past
          evaluations stay measured against the rubric they were scored with.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setView({ name: "import" })}
            className="border border-rule rounded px-3.5 py-2 text-sm hover:bg-ground-2"
          >
            Import
          </button>
          <button
            onClick={() => setView({ name: "compare" })}
            disabled={(versions?.length ?? 0) < 2}
            className="border border-rule rounded px-3.5 py-2 text-sm hover:bg-ground-2 disabled:opacity-40"
          >
            Compare
          </button>
        </div>
      </div>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      {active && (
        <ActiveCard
          version={active}
          onCopied={(id) => {
            void load();
            setView({ name: "edit", id });
          }}
          onPreview={() => setView({ name: "preview", id: active.id })}
          onError={setError}
        />
      )}

      {versions === null ? (
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      ) : others.length === 0 ? (
        <p className="text-[13px] text-ink-45 mt-5">No other versions yet.</p>
      ) : (
        <ul className="space-y-2 mt-5">
          {others.map((v) => (
            <VersionRow
              key={v.id}
              version={v}
              onChanged={load}
              onEdit={() => setView({ name: "edit", id: v.id })}
              onPreview={() => setView({ name: "preview", id: v.id })}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: VersionStatus }): JSX.Element {
  const tone =
    status === "active"
      ? "border-[#1F7A4D] text-[#1F7A4D]"
      : status === "review"
        ? "border-[#2C6E9B] text-[#2C6E9B]"
        : status === "draft"
          ? "border-[#96690A] text-[#96690A]"
          : "border-rule text-ink-45";
  const label = status === "review" ? "In review" : status;
  return (
    <span className={`text-[11px] border rounded-full px-2 py-0.5 capitalize ${tone}`}>
      {label}
    </span>
  );
}

function ActiveCard({
  version,
  onCopied,
  onPreview,
  onError,
}: {
  version: RubricVersionRow;
  onCopied: (id: string) => void;
  onPreview: () => void;
  onError: (m: string) => void;
}): JSX.Element {
  const [copying, setCopying] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function copy(): Promise<void> {
    setBusy(true);
    try {
      const id = await copyVersion(version.id, label);
      setLabel("");
      setCopying(false);
      onCopied(id);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border border-ink rounded px-4 py-4">
      <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
        In use now
      </p>
      <div className="flex justify-between items-baseline gap-4 flex-wrap mt-1">
        <div>
          <span className="font-display text-xl">
            {version.title} &middot; v{version.version_label}
          </span>
          <p className="text-[12px] text-ink-45 mt-0.5">
            {version.criterion_count} criteria &middot; {version.evaluations_using}{" "}
            evaluation{version.evaluations_using === 1 ? "" : "s"} scored against it
            {version.activated_at && ` · since ${formatDate(version.activated_at)}`}
          </p>
        </div>

        {copying ? (
          <div className="flex gap-2 items-center">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="1.1"
              className="w-20 border border-rule rounded px-2 py-1.5 bg-white text-[13px]"
            />
            <button
              onClick={() => void copy()}
              disabled={!label.trim() || busy}
              className="bg-ink text-ground border border-ink rounded px-3 py-1.5 text-[13px] disabled:opacity-40"
            >
              Create
            </button>
            <button
              onClick={() => setCopying(false)}
              className="border border-rule rounded px-3 py-1.5 text-[13px]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={onPreview}
              className="border border-rule rounded px-3.5 py-1.5 text-[13px] hover:bg-ground-2"
            >
              Preview
            </button>
            <button
              onClick={() => setCopying(true)}
              className="border border-rule rounded px-3.5 py-1.5 text-[13px] hover:bg-ground-2"
            >
              New version from this
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function VersionRow({
  version,
  onChanged,
  onEdit,
  onPreview,
  onError,
}: {
  version: RubricVersionRow;
  onChanged: () => Promise<void>;
  onEdit: () => void;
  onPreview: () => void;
  onError: (m: string) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function act(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="bg-card border border-rule-soft rounded px-4 py-3">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div className="min-w-0">
          <span className="font-display text-base">
            {version.title} &middot; v{version.version_label}
          </span>
          <span className="ml-2">
            <StatusChip status={version.status} />
          </span>
          <p className="text-[12px] text-ink-45 mt-0.5">
            {version.criterion_count} criteria
            {version.created_by_name && ` · by ${version.created_by_name}`}
            {version.requested_by && ` · requested by ${version.requested_by}`}
            {version.evaluations_using > 0 &&
              ` · used by ${version.evaluations_using} evaluation${version.evaluations_using === 1 ? "" : "s"}`}
            {version.archived_at && ` · archived ${formatDate(version.archived_at)}`}
          </p>
          {version.change_summary && (
            <p className="text-[12.5px] text-ink-70 mt-1">{version.change_summary}</p>
          )}
        </div>

        <div className="flex gap-2 shrink-0 flex-wrap">
          <button
            onClick={onPreview}
            className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2"
          >
            Preview
          </button>

          {version.status === "draft" && (
            <>
              <button
                onClick={onEdit}
                className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2"
              >
                Edit
              </button>
              <button
                onClick={() => void act(() => submitForReview(version.id))}
                disabled={busy}
                className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2 disabled:opacity-40"
              >
                Send for review
              </button>
              {confirmDelete ? (
                <button
                  onClick={() => void act(() => deleteDraft(version.id))}
                  disabled={busy}
                  className="bg-[#AC3A2A] text-white border border-[#AC3A2A] rounded px-3 py-1.5 text-[12.5px]"
                >
                  Confirm delete
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-[12.5px] text-ink-45 underline underline-offset-2 hover:text-ink px-1"
                >
                  Delete
                </button>
              )}
            </>
          )}

          {version.status === "review" && (
            <>
              <button
                onClick={() => void act(() => returnToDraft(version.id))}
                disabled={busy}
                className="border border-rule rounded px-3 py-1.5 text-[12.5px] hover:bg-ground-2 disabled:opacity-40"
              >
                Return to draft
              </button>
              <button
                onClick={() => void act(() => activateVersion(version.id))}
                disabled={busy}
                className="bg-ink text-ground border border-ink rounded px-3 py-1.5 text-[12.5px] font-medium hover:opacity-85 disabled:opacity-40"
              >
                Make it the active rubric
              </button>
            </>
          )}
        </div>
      </div>

      {version.status === "review" && (
        <p className="text-[12px] text-[#2C6E9B] mt-2">
          Frozen for review. Nobody can change it until it is returned to draft.
        </p>
      )}
    </li>
  );
}

// ------------------------------------------------------------ editor

function VersionEditor({
  versionId,
  onBack,
}: {
  versionId: string;
  onBack: () => void;
}): JSX.Element {
  const [criteria, setCriteria] = useState<FlatCriterion[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [version, setVersion] = useState<RubricVersionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [c, s, all] = await Promise.all([
        getCriteria(versionId),
        getSections(versionId),
        listVersions(),
      ]);
      setCriteria(c);
      setSections(s);
      setVersion(all.find((v) => v.id === versionId) ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [versionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveCriterion(
    id: string,
    patch: Parameters<typeof updateCriterion>[1],
  ): Promise<void> {
    try {
      await updateCriterion(id, patch);
      setSavedAt(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Swaps sort_order with the neighbour — reordering without SQL. */
  async function move(c: FlatCriterion, direction: -1 | 1): Promise<void> {
    const siblings = criteria.filter((x) => x.section_code === c.section_code);
    const i = siblings.findIndex((x) => x.criterion_id === c.criterion_id);
    const other = siblings[i + direction];
    if (!other) return;
    try {
      await Promise.all([
        updateCriterion(c.criterion_id, { sort_order: other.sort_order }),
        updateCriterion(other.criterion_id, { sort_order: c.sort_order }),
      ]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!version) return <p className="text-ink-45 text-sm">Loading&hellip;</p>;

  const locked = version.status !== "draft";

  return (
    <div>
      <button
        onClick={onBack}
        className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
      >
        &larr; All versions
      </button>

      <div className="flex justify-between items-baseline gap-4 flex-wrap mt-3 mb-4">
        <div>
          <h2 className="font-display text-2xl">
            {version.title} &middot; v{version.version_label}
          </h2>
          <p className="text-[12px] text-ink-45 mt-0.5">
            {criteria.length} criteria &middot; <StatusChip status={version.status} />
          </p>
        </div>
        {savedAt && (
          <span className="text-[12px] text-ink-45">
            Saved at {savedAt.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      {locked && (
        <p className="text-[13px] text-[#2C6E9B] mb-4">
          This version is frozen. Return it to draft to make changes.
        </p>
      )}

      {!locked && <VersionMeta version={version} onSaved={load} onError={setError} />}

      {sections.map((section) => {
        const rows = criteria.filter((c) => c.section_code === section.code);
        return (
          <section key={section.id} className="mt-6">
            <h3 className="font-display text-xl border-b border-rule pb-2 mb-3">
              {section.title}
              <span className="font-sans text-[12px] text-ink-45 ml-2.5">
                {rows.length}
              </span>
            </h3>

            {rows.map((c, i) => (
              <CriterionEditor
                key={c.criterion_id}
                criterion={c}
                locked={locked}
                isFirst={i === 0}
                isLast={i === rows.length - 1}
                onSave={(patch) => void saveCriterion(c.criterion_id, patch)}
                onMove={(d) => void move(c, d)}
                onRemove={() => {
                  void removeCriterion(c.criterion_id)
                    .then(load)
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                }}
              />
            ))}

            {!locked && (
              <div className="mt-2">
                {adding === section.id ? (
                  <NewCriterion
                    versionId={versionId}
                    sectionId={section.id}
                    nextOrder={(rows[rows.length - 1]?.sort_order ?? 0) + 1}
                    onDone={() => {
                      setAdding(null);
                      void load();
                    }}
                    onCancel={() => setAdding(null)}
                    onError={setError}
                  />
                ) : (
                  <button
                    onClick={() => setAdding(section.id)}
                    className="text-[12.5px] text-ink-45 underline underline-offset-2 hover:text-ink"
                  >
                    Add a criterion to this section
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function VersionMeta({
  version,
  onSaved,
  onError,
}: {
  version: RubricVersionRow;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    description: version.description,
    change_summary: version.change_summary,
    requested_by: version.requested_by,
    approved_by: version.approved_by,
    effective_date: version.effective_date ?? "",
  });

  async function save(): Promise<void> {
    try {
      await updateVersionMeta(version.id, {
        ...form,
        effective_date: form.effective_date || null,
      });
      await onSaved();
      setOpen(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[12.5px] text-ink-45 underline underline-offset-2 hover:text-ink"
      >
        Edit version details
      </button>
    );
  }

  return (
    <div className="bg-card border border-rule-soft rounded px-4 py-4 space-y-3">
      <Field
        label="What changed"
        hint="A short summary executives will read"
        value={form.change_summary}
        onChange={(v) => setForm({ ...form, change_summary: v })}
        multiline
      />
      <Field
        label="Why this version exists"
        value={form.description}
        onChange={(v) => setForm({ ...form, description: v })}
        multiline
      />
      <div className="grid sm:grid-cols-3 gap-3">
        <Field
          label="Requested by"
          value={form.requested_by}
          onChange={(v) => setForm({ ...form, requested_by: v })}
        />
        <Field
          label="Approved by"
          value={form.approved_by}
          onChange={(v) => setForm({ ...form, approved_by: v })}
        />
        <Field
          label="Effective date"
          type="date"
          value={form.effective_date}
          onChange={(v) => setForm({ ...form, effective_date: v })}
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => void save()}
          className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium"
        >
          Save
        </button>
        <button
          onClick={() => setOpen(false)}
          className="border border-rule rounded px-3.5 py-1.5 text-[13px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  multiline = false,
  type = "text",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  type?: string;
}): JSX.Element {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold mb-1.5">
        {label}
        {hint && <span className="font-normal text-ink-45"> — {hint}</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
        />
      )}
    </label>
  );
}

function CriterionEditor({
  criterion,
  locked,
  isFirst,
  isLast,
  onSave,
  onMove,
  onRemove,
}: {
  criterion: FlatCriterion;
  locked: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSave: (patch: Parameters<typeof updateCriterion>[1]) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    code: criterion.code,
    label: criterion.label,
    stage: criterion.stage,
    statement: criterion.statement,
    na_condition: criterion.na_condition,
    guidance: criterion.guidance.join("\n"),
  });

  function commit(): void {
    onSave({
      code: form.code,
      label: form.label,
      stage: form.stage,
      statement: form.statement,
      na_condition: form.na_condition,
      guidance: form.guidance.split("\n").map((g) => g.trim()).filter(Boolean),
    });
  }

  return (
    <div className="bg-card border border-rule-soft rounded px-4 py-3 mb-2">
      <div className="flex justify-between items-start gap-3">
        <p className="text-[14px] min-w-0 flex-1">
          <span className="font-mono text-[11px] text-ink-45 mr-2">{criterion.code}</span>
          {criterion.label && <span className="font-semibold">{criterion.label}. </span>}
          {criterion.statement}
        </p>
        {!locked && (
          <div className="flex gap-1.5 shrink-0 items-center">
            <button
              onClick={() => onMove(-1)}
              disabled={isFirst}
              title="Move up"
              className="border border-rule rounded w-7 h-7 text-[12px] hover:bg-ground-2 disabled:opacity-30"
            >
              &uarr;
            </button>
            <button
              onClick={() => onMove(1)}
              disabled={isLast}
              title="Move down"
              className="border border-rule rounded w-7 h-7 text-[12px] hover:bg-ground-2 disabled:opacity-30"
            >
              &darr;
            </button>
            <button
              onClick={() => setOpen((o) => !o)}
              className="border border-rule rounded px-2.5 py-1 text-[12.5px] hover:bg-ground-2"
            >
              {open ? "Close" : "Edit"}
            </button>
          </div>
        )}
      </div>

      {open && !locked && (
        <div className="mt-3 border-t border-rule-soft pt-3 space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
            <Field label="Short name" value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
            <Field label="Stage" value={form.stage} onChange={(v) => setForm({ ...form, stage: v })} />
          </div>
          <Field
            label="The criterion"
            hint="what an evaluator answers yes or no to"
            value={form.statement}
            onChange={(v) => setForm({ ...form, statement: v })}
            multiline
          />
          <Field
            label="What to listen for"
            hint="one per line"
            value={form.guidance}
            onChange={(v) => setForm({ ...form, guidance: v })}
            multiline
          />
          <Field
            label="N/A if"
            value={form.na_condition}
            onChange={(v) => setForm({ ...form, na_condition: v })}
            multiline
          />
          <div className="flex justify-between items-center gap-3">
            <button
              onClick={() => {
                commit();
                setOpen(false);
              }}
              className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium"
            >
              Save changes
            </button>
            <button
              onClick={onRemove}
              className="text-[12.5px] text-[#AC3A2A] underline underline-offset-2"
            >
              Remove this criterion
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewCriterion({
  versionId,
  sectionId,
  nextOrder,
  onDone,
  onCancel,
  onError,
}: {
  versionId: string;
  sectionId: string;
  nextOrder: number;
  onDone: () => void;
  onCancel: () => void;
  onError: (m: string) => void;
}): JSX.Element {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [statement, setStatement] = useState("");

  async function add(): Promise<void> {
    try {
      await addCriterion({ versionId, sectionId, code, label, statement, sortOrder: nextOrder });
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="bg-card border border-rule-soft rounded px-4 py-3 space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Code" value={code} onChange={setCode} />
        <Field label="Short name" value={label} onChange={setLabel} />
      </div>
      <Field label="The criterion" value={statement} onChange={setStatement} multiline />
      <div className="flex gap-2">
        <button
          onClick={() => void add()}
          disabled={!code.trim() || !statement.trim()}
          className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-40"
        >
          Add
        </button>
        <button onClick={onCancel} className="border border-rule rounded px-3.5 py-1.5 text-[13px]">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ preview

/**
 * Shows the rubric as an evaluator will meet it.
 *
 * The two roles see genuinely different things — a reviewer records
 * observations with no score, a trainer decides an outcome — so previewing
 * "as a reviewer" is not cosmetic. It is the only way to check the wording
 * reads correctly in the context where it will be used.
 */
function VersionPreview({
  versionId,
  onBack,
}: {
  versionId: string;
  onBack: () => void;
}): JSX.Element {
  const [criteria, setCriteria] = useState<FlatCriterion[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [as, setAs] = useState<"reviewer" | "trainer">("reviewer");
  const [showGuidance, setShowGuidance] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getCriteria(versionId), getSections(versionId)]).then(([c, s]) => {
      setCriteria(c);
      setSections(s);
    });
  }, [versionId]);

  return (
    <div>
      <button
        onClick={onBack}
        className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
      >
        &larr; All versions
      </button>

      <div className="flex justify-between items-baseline gap-4 flex-wrap mt-3 mb-4">
        <h2 className="font-display text-2xl">Preview</h2>
        <div className="flex gap-1.5">
          {(["reviewer", "trainer"] as const).map((role) => (
            <button
              key={role}
              onClick={() => setAs(role)}
              className={`border rounded-full px-3.5 py-1.5 text-[13px] ${
                as === role ? "bg-ink text-ground border-ink" : "border-rule hover:bg-ground-2"
              }`}
            >
              {role === "reviewer" ? "As a Raw QA Reviewer" : "As a QA Trainer"}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-rule rounded bg-ground px-4 py-3 mb-5">
        <p className="text-[13px] text-ink-70">
          {as === "reviewer"
            ? "A reviewer answers each criterion and sees no score, no percentage and no reward tier — only how many they have observed."
            : "A trainer sees the reviewer's answers pre-filled, decides the outcome, and completes the final determination."}
        </p>
      </div>

      {/* Mimics the evaluation workspace header */}
      <div className="border-b border-rule pb-3 mb-4 flex justify-between items-center gap-4 flex-wrap">
        <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45">
          {as === "reviewer" ? "Raw observation" : "Calibration"}
        </p>
        <div className="flex items-center gap-5">
          {as === "trainer" && (
            <span className="text-right">
              <span className="font-display text-2xl block leading-none">—</span>
              <span className="text-[11px] text-ink-45">score</span>
            </span>
          )}
          <span className="text-right">
            <span className="font-display text-2xl block leading-none">
              0/{criteria.length}
            </span>
            <span className="text-[11px] text-ink-45">
              {as === "reviewer" ? "observed" : "answered"}
            </span>
          </span>
        </div>
      </div>

      {sections.map((section) => {
        const rows = criteria.filter((c) => c.section_code === section.code);
        return (
          <section key={section.id} className="mb-6">
            <h3 className="font-display text-xl border-b border-rule pb-2 mb-3">
              {section.title}
            </h3>
            {section.description && (
              <p className="text-[13px] text-ink-70 mb-3">{section.description}</p>
            )}

            {rows.map((c, i) => {
              const prevStage = i > 0 ? rows[i - 1]?.stage : undefined;
              return (
                <div key={c.criterion_id}>
                  {c.stage && c.stage !== prevStage && (
                    <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-45 mt-4 mb-2">
                      {c.stage}
                    </p>
                  )}
                  <div className="bg-card border border-rule-soft rounded px-4 py-3 mb-2">
                    <div className="flex justify-between items-start gap-4 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px]">
                          <span className="font-mono text-[11px] text-ink-45 mr-2">
                            {c.code}
                          </span>
                          {c.label && c.section_kind === "non_negotiable" && (
                            <span className="font-semibold">{c.label}. </span>
                          )}
                          {c.statement}
                        </p>
                        {(c.guidance.length > 0 || c.na_condition) && (
                          <button
                            onClick={() =>
                              setShowGuidance(
                                showGuidance === c.criterion_id ? null : c.criterion_id,
                              )
                            }
                            className="text-[12px] text-ink-45 underline underline-offset-2 mt-1.5"
                          >
                            What to listen for
                          </button>
                        )}
                        {showGuidance === c.criterion_id && (
                          <div className="mt-2 text-[12.5px] text-ink-70 border-l-2 border-rule pl-3">
                            {c.guidance.map((g) => (
                              <p key={g} className="mb-1">
                                {g}
                              </p>
                            ))}
                            {c.na_condition && (
                              <p className="mt-2">
                                <span className="font-semibold">N/A if:</span> {c.na_condition}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {["YES", "NO", "N/A"].map((v) => (
                          <span
                            key={v}
                            className="border border-rule rounded px-3 py-1.5 text-[13px] font-mono text-ink-45"
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      {as === "trainer" && (
        <section className="mb-6">
          <h3 className="font-display text-xl border-b border-rule pb-2 mb-3">
            Final determination
          </h3>
          <p className="text-[13px] text-ink-45">
            Author&rsquo;s end state, escalation flag and summary. Trainer only.
          </p>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------ comparison

function CompareVersions({
  versions,
  onBack,
}: {
  versions: RubricVersionRow[];
  onBack: () => void;
}): JSX.Element {
  const [leftId, setLeftId] = useState(versions[1]?.id ?? "");
  const [rightId, setRightId] = useState(versions[0]?.id ?? "");
  const [left, setLeft] = useState<FlatCriterion[]>([]);
  const [right, setRight] = useState<FlatCriterion[]>([]);
  const [showUnchanged, setShowUnchanged] = useState(false);

  useEffect(() => {
    if (leftId) void getCriteria(leftId).then(setLeft);
  }, [leftId]);
  useEffect(() => {
    if (rightId) void getCriteria(rightId).then(setRight);
  }, [rightId]);

  const diffs = useMemo(() => compareVersions(left, right), [left, right]);
  const changed = diffs.filter((d) => d.change !== "unchanged");
  const visible = showUnchanged ? diffs : changed;

  const leftV = versions.find((v) => v.id === leftId);
  const rightV = versions.find((v) => v.id === rightId);

  return (
    <div>
      <button
        onClick={onBack}
        className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
      >
        &larr; All versions
      </button>

      <h2 className="font-display text-2xl mt-3 mb-1">Compare versions</h2>
      <p className="text-[13px] text-ink-70 mb-4 max-w-xl">
        What would change if the version on the right replaced the one on the left.
      </p>

      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        <label className="block">
          <span className="block text-[12px] font-semibold mb-1.5">From</span>
          <select
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
            className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version_label} — {v.status}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[12px] font-semibold mb-1.5">To</span>
          <select
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
            className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version_label} — {v.status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-3 border-y border-rule mb-4">
        <Figure
          value={String(diffs.filter((d) => d.change === "added").length)}
          caption="added"
        />
        <Figure
          value={String(diffs.filter((d) => d.change === "removed").length)}
          caption="removed"
        />
        <Figure
          value={String(diffs.filter((d) => d.change === "modified").length)}
          caption="reworded"
        />
      </div>

      {changed.length === 0 ? (
        <p className="text-[13px] text-ink-70 py-6 text-center">
          These two versions are identical.
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-45 mb-3">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => setShowUnchanged(e.target.checked)}
            />
            Also show what stayed the same
          </label>

          <ul className="space-y-2">
            {visible.map((d) => (
              <li
                key={d.code}
                className={`bg-card border rounded px-4 py-3 ${
                  d.change === "added"
                    ? "border-[#1F7A4D]"
                    : d.change === "removed"
                      ? "border-[#AC3A2A]"
                      : d.change === "modified"
                        ? "border-[#96690A]"
                        : "border-rule-soft"
                }`}
              >
                <div className="flex items-baseline gap-2.5 flex-wrap">
                  <span className="font-mono text-[11px] text-ink-45">{d.code}</span>
                  <span
                    className="text-[11px] uppercase tracking-wide"
                    style={{
                      color:
                        d.change === "added"
                          ? "#1F7A4D"
                          : d.change === "removed"
                            ? "#AC3A2A"
                            : d.change === "modified"
                              ? "#96690A"
                              : "#6B6F68",
                    }}
                  >
                    {d.change}
                  </span>
                  {d.fields.length > 0 && (
                    <span className="text-[12px] text-ink-45">{d.fields.join(", ")}</span>
                  )}
                </div>

                {d.change === "added" && d.right && (
                  <p className="text-[13.5px] mt-1.5">{d.right.statement}</p>
                )}
                {d.change === "removed" && d.left && (
                  <p className="text-[13.5px] mt-1.5 text-ink-45 line-through">
                    {d.left.statement}
                  </p>
                )}
                {d.change === "modified" && d.left && d.right && (
                  <div className="mt-1.5 space-y-1">
                    <p className="text-[13px] text-ink-45">
                      <span className="font-mono text-[11px] mr-1.5">was</span>
                      {d.left.statement}
                    </p>
                    <p className="text-[13.5px]">
                      <span className="font-mono text-[11px] text-ink-45 mr-1.5">now</span>
                      {d.right.statement}
                    </p>
                  </div>
                )}
                {d.change === "unchanged" && d.right && (
                  <p className="text-[13px] text-ink-45 mt-1.5">{d.right.statement}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {leftV && rightV && (
        <p className="text-[12px] text-ink-45 mt-5">
          v{leftV.version_label} has {left.length} criteria; v{rightV.version_label} has{" "}
          {right.length}.
        </p>
      )}
    </div>
  );
}

function Figure({ value, caption }: { value: string; caption: string }): JSX.Element {
  return (
    <div className="py-3.5 pr-5 border-r border-rule-soft last:border-r-0">
      <span className="font-display text-2xl block leading-none mb-1">{value}</span>
      <span className="text-[11.5px] text-ink-45">{caption}</span>
    </div>
  );
}

// ------------------------------------------------------------ import

/**
 * Guided import.
 *
 * The document is only a source. What it produces is a draft that lives here,
 * and nothing is created until the mapping has been reviewed — a misread column
 * should cost a correction, never a wrong rubric.
 */
function ImportRubric({
  onBack,
  onImported,
}: {
  onBack: () => void;
  onImported: (id: string) => void;
}): JSX.Element {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<ParsedCriterion[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [title, setTitle] = useState("Call Calibration Evaluation Sheet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function detect(): void {
    const result = parseDelimited(text);
    setRows(result.rows);
    setWarnings(result.warnings);
    setStep(2);
  }

  async function create(): Promise<void> {
    setBusy(true);
    try {
      const id = await createDraftFromImport({
        label,
        title,
        sourceDocument: filename,
        rows,
      });
      onImported(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
      >
        &larr; All versions
      </button>

      <h2 className="font-display text-2xl mt-3 mb-1">Import a rubric</h2>
      <p className="text-[13px] text-ink-70 mb-5 max-w-xl">
        The document is only the source. What you get is a draft that lives here
        and can be edited &mdash; after that the file has done its job.
      </p>

      <div className="flex gap-2 mb-5">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`text-[12px] px-3 py-1 rounded-full border ${
              step === n
                ? "bg-ink text-ground border-ink"
                : step > n
                  ? "border-rule text-ink-45"
                  : "border-rule-soft text-ink-45"
            }`}
          >
            {n}. {n === 1 ? "Source" : n === 2 ? "Check what was found" : "Create draft"}
          </span>
        ))}
      </div>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <span className="block text-[12px] font-semibold mb-1.5">
              Paste the criteria
              <span className="font-normal text-ink-45">
                {" "}
                — copy the table straight out of Word or Excel
              </span>
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder={
                "Code\tName\tStatement\n" +
                "S1.1\tStandard opening\tAgent used the standard opening spiel.\n" +
                "NN1\tProfessional Composure\tThe representative remained calm throughout."
              }
              className="w-full border border-rule rounded px-3 py-2.5 bg-white text-[13px] font-mono"
            />
            <p className="text-[12px] text-ink-45 mt-1.5">
              Copying a table from Word or Excel pastes it as columns
              automatically. A CSV file works too &mdash; open it and paste the
              contents.
            </p>
          </div>

          <label className="block max-w-sm">
            <span className="block text-[12px] font-semibold mb-1.5">
              Where it came from
              <span className="font-normal text-ink-45"> — recorded on the draft</span>
            </span>
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="Call_Calibration_Form_3.docx"
              className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm"
            />
          </label>

          <button
            onClick={detect}
            disabled={!text.trim()}
            className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            Read it
          </button>
        </div>
      )}

      {step === 2 && (
        <div>
          {warnings.map((w) => (
            <p key={w} className="text-[13px] text-[#96690A] mb-2">
              {w}
            </p>
          ))}

          <p className="text-[13px] text-ink-70 mb-3">
            Found <span className="font-semibold">{rows.length}</span> criteria
            &mdash;{" "}
            {rows.filter((r) => r.kind === "checklist").length} checklist,{" "}
            {rows.filter((r) => r.kind === "non_negotiable").length} non-negotiable.
            Check these are right before continuing.
          </p>

          <div className="border border-rule-soft rounded bg-card max-h-96 overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-rule text-left">
                  <th className="py-2 px-3 font-mono text-[10px] uppercase text-ink-45 font-normal">
                    Code
                  </th>
                  <th className="py-2 px-3 font-mono text-[10px] uppercase text-ink-45 font-normal">
                    Section
                  </th>
                  <th className="py-2 px-3 font-mono text-[10px] uppercase text-ink-45 font-normal">
                    Criterion
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.code}-${i}`} className="border-b border-rule-soft">
                    <td className="py-2 px-3 font-mono text-[11.5px]">{r.code}</td>
                    <td className="py-2 px-3 text-[12px] text-ink-45">
                      {r.kind === "non_negotiable" ? "Non-negotiable" : "Checklist"}
                    </td>
                    <td className="py-2 px-3">
                      {r.label && <span className="font-semibold">{r.label}. </span>}
                      {r.statement}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setStep(3)}
              disabled={rows.length === 0}
              className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              These look right
            </button>
            <button
              onClick={() => setStep(1)}
              className="border border-rule rounded px-4 py-2 text-sm hover:bg-ground-2"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 max-w-md">
          <Field
            label="Version number"
            hint="must not already exist"
            value={label}
            onChange={setLabel}
          />
          <Field label="Title" value={title} onChange={setTitle} />

          <p className="text-[13px] text-ink-70">
            This creates a <span className="font-semibold">draft</span> with{" "}
            {rows.length} criteria. Nothing operational changes until you review
            and activate it.
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => void create()}
              disabled={!label.trim() || busy}
              className="bg-ink text-ground border border-ink rounded px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create draft"}
            </button>
            <button
              onClick={() => setStep(2)}
              className="border border-rule rounded px-4 py-2 text-sm hover:bg-ground-2"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
