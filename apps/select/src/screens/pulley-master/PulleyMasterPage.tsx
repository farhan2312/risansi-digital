"use client";

import { useEffect, useMemo, useState } from "react";
import "../pump-model-master/PumpModelMasterPage.css";
import {
  createPulleyMotorRow,
  deletePulleyMotorRow,
  listPulleyBeltRows,
  listPulleyMotorRows,
  updatePulleyMotorRow,
  type PulleyBeltInput,
  type PulleyBeltRow,
  type PulleyMotorInsert,
  type PulleyMotorPatch,
  type PulleyMotorRow,
} from "../../services/pulleyMasterService";
import EmptyState from "../../components/ui/EmptyState";
import { SkeletonRows } from "../../components/ui/Skeleton";
import Spinner from "../../components/ui/Spinner";
import Pagination, { usePagination } from "../../components/ui/Pagination";
import { FilterBar, SortTh, useTableControls, type ColumnSpec } from "../../components/ui/tableControls";
import { comparePumpFamilies, comparePumpModels, pumpModelFamily } from "../../lib/pump-model-order";
import {
  PlusIcon,
  SearchIcon,
  DetailsIcon,
  EditIcon,
  TrashIcon,
  AlertIcon,
} from "../../components/ui/adminIcons";

type FieldDef = { key: keyof PulleyMotorRow; label: string; numeric: boolean; required?: boolean };

// Editable columns, in form/details order. id is never editable.
const FIELDS: FieldDef[] = [
  { key: "model", label: "Model", numeric: false, required: true },
  { key: "motorRpm", label: "Motor RPM", numeric: true, required: true },
  { key: "motorHp", label: "Motor HP", numeric: true },
  { key: "motorKw", label: "Motor kW", numeric: true },
  { key: "maxCapAt60Mwc", label: "Max Cap @ 60 MWC", numeric: true },
  { key: "grooves", label: "Grooves", numeric: false },
  { key: "pumpShaftDia", label: "Pump Shaft Dia", numeric: true },
  { key: "pumpShaftLength", label: "Pump Shaft Length", numeric: true },
  { key: "motorShaftDia", label: "Motor Shaft Dia", numeric: true },
  { key: "motorShaftLength", label: "Motor Shaft Length", numeric: true },
];

const val = (v: string | number | null) => (v === null || v === "" ? "—" : v);

// Default order: model family (Barrel -> H -> 2H -> 4H -> 8H), size within
// the family, then motor kW ascending (then motor RPM).
const defaultSort = (a: PulleyMotorRow, b: PulleyMotorRow) =>
  comparePumpModels(a.model, b.model) ||
  Number(a.motorKw ?? 0) - Number(b.motorKw ?? 0) ||
  a.motorRpm - b.motorRpm;

const COLUMNS: ColumnSpec<PulleyMotorRow>[] = [
  { key: "family", label: "Family", get: (r) => pumpModelFamily(r.model), filter: "select", optionCompare: comparePumpFamilies },
  { key: "model", label: "Model", get: (r) => r.model, filter: "select", optionCompare: comparePumpModels, compare: defaultSort },
  { key: "motorRpm", label: "Motor RPM", get: (r) => r.motorRpm, numeric: true, filter: "select" },
  { key: "motorHp", label: "Motor HP", get: (r) => r.motorHp, numeric: true },
  { key: "motorKw", label: "Motor kW", get: (r) => r.motorKw, numeric: true, filter: "select" },
  { key: "grooves", label: "Grooves", get: (r) => r.grooves, filter: "select" },
  { key: "maxCapAt60Mwc", label: "Max Cap @ 60 MWC", get: (r) => r.maxCapAt60Mwc, numeric: true, filter: "range" },
];

const errorMessage = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;

const emptyForm = (): Record<string, string> =>
  Object.fromEntries(FIELDS.map((f) => [f.key, ""]));

// --- Belt-options form model ----------------------------------------------
//
// Belt rows are rendered as an inline editable sub-table. Each row carries a
// client-only `_key` so React can identify it stably across renders (the DB
// id isn't known for freshly-added rows, and rows can be reordered/deleted).
type BeltRowFormShape = {
  _key: string;
  targetRpm: string;
  pmpPulley: string;
  mtrPulley: string;
  actualRpm: string;
  centerDistance: string;
  vBelt: string;
};

const BELT_FIELDS: {
  key: Exclude<keyof BeltRowFormShape, "_key">;
  label: string;
  required?: boolean;
}[] = [
  { key: "targetRpm", label: "Target RPM", required: true },
  { key: "pmpPulley", label: "Pump Pulley" },
  { key: "mtrPulley", label: "Motor Pulley" },
  { key: "actualRpm", label: "Actual RPM" },
  { key: "centerDistance", label: "Centre Dist" },
  { key: "vBelt", label: "V-Belt No." },
];

let beltKeyCounter = 0;
const newBeltKey = () => `belt-${++beltKeyCounter}`;

const emptyBeltRow = (): BeltRowFormShape => ({
  _key: newBeltKey(),
  targetRpm: "",
  pmpPulley: "",
  mtrPulley: "",
  actualRpm: "",
  centerDistance: "",
  vBelt: "",
});

const beltToFormShape = (b: PulleyBeltRow): BeltRowFormShape => ({
  _key: newBeltKey(),
  targetRpm: String(b.targetRpm),
  pmpPulley: b.pmpPulley ?? "",
  mtrPulley: b.mtrPulley ?? "",
  actualRpm: b.actualRpm ?? "",
  centerDistance: b.centerDistance ?? "",
  vBelt: b.vBelt ?? "",
});

/** Convert form-shape belts to the API payload. Rows with a blank/invalid
 * targetRpm are dropped rather than rejected (they're incomplete drafts). */
const beltFormToApi = (rows: BeltRowFormShape[]): PulleyBeltInput[] => {
  const out: PulleyBeltInput[] = [];
  for (const r of rows) {
    const n = Number(r.targetRpm);
    if (r.targetRpm.trim() === "" || Number.isNaN(n)) continue;
    out.push({
      targetRpm: n,
      pmpPulley: r.pmpPulley.trim() === "" ? null : r.pmpPulley,
      mtrPulley: r.mtrPulley.trim() === "" ? null : r.mtrPulley,
      actualRpm: r.actualRpm.trim() === "" ? null : r.actualRpm,
      centerDistance: r.centerDistance.trim() === "" ? null : r.centerDistance,
      vBelt: r.vBelt.trim() === "" ? null : r.vBelt,
    });
  }
  return out;
};

const PulleyMasterPage = () => {
  const [rows, setRows] = useState<PulleyMotorRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Search / sort / filter over every row (components/ui/tableControls.tsx).
  const controls = useTableControls(rows, COLUMNS, defaultSort);
  const filtered = controls.result;

  const [detailsRow, setDetailsRow] = useState<PulleyMotorRow | null>(null);
  const [editRow, setEditRow] = useState<PulleyMotorRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<PulleyMotorRow | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    listPulleyMotorRows()
      .then(setRows)
      .catch(() => setError("Couldn't load pulley master data."))
      .finally(() => setIsLoading(false));
  }, []);


  // 50 rows/page. Resets to page 1 whenever the search changes.
  const { page, setPage, from, to, pageSize } = usePagination(
    filtered.length,
    controls.resetKey,
    50
  );
  const paged = useMemo(() => filtered.slice(from, to), [filtered, from, to]);

  const handleCreated = (created: PulleyMotorRow) => {
    setRows((prev) =>
      [...prev, created].sort((a, b) =>
        a.model === b.model
          ? a.motorRpm - b.motorRpm
          : a.model.localeCompare(b.model)
      )
    );
    setCreating(false);
  };

  const handleSaved = (updated: PulleyMotorRow) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setEditRow(null);
  };

  const handleDeleted = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setDeleteRow(null);
  };

  return (
    <div className="pmm-page">
      <div className="pmm-header">
        <div>
          <h1>Pulley Master</h1>
          <p>
            Every (model, motor RPM) row from the pulley/motor master. Edit
            or delete a row, or view its full details including the belt options.
          </p>
        </div>
        <div className="pmm-header-actions">
          <div className="pmm-search-wrap">
            <span className="pmm-search-icon"><SearchIcon /></span>
            <input
              type="search"
              className="pmm-search"
              placeholder="Search model, RPM, kW, groove…"
              value={controls.search}
              onChange={(e) => controls.setSearch(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <PlusIcon /> Add Model Data
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="pmm-panel">
          <div style={{ padding: 16 }}>
            <SkeletonRows rows={8} cols={5} />
          </div>
        </div>
      )}

      {!isLoading && error && (
        <div className="pmm-form-error"><AlertIcon /><span>{error}</span></div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <EmptyState
          icon="table"
          title="No pulley rows yet"
          description="The pulley master is empty. Add the first row to seed it — belt options can be added inline as children."
          action={
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <PlusIcon /> Add first row
            </button>
          }
        />
      )}

      {!isLoading && !error && rows.length > 0 && (
        <div className="pmm-panel">
          <FilterBar controls={controls} columns={COLUMNS} total={rows.length} />
          <div className="pmm-table-wrap">
            <table className="pmm-table">
              <thead>
                <tr>
                  <SortTh controls={controls} colKey="model">Model</SortTh>
                  <SortTh controls={controls} colKey="motorRpm">Motor RPM</SortTh>
                  <SortTh controls={controls} colKey="motorHp">Motor HP</SortTh>
                  <SortTh controls={controls} colKey="motorKw">Motor kW</SortTh>
                  <SortTh controls={controls} colKey="grooves">Grooves</SortTh>
                  <SortTh controls={controls} colKey="maxCapAt60Mwc">Max Cap @ 60 MWC</SortTh>
                  <th className="pmm-actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id}>
                    <td className="pmm-model">{r.model}</td>
                    <td className="mono">{val(r.motorRpm)}</td>
                    <td className="mono">{val(r.motorHp)}</td>
                    <td className="mono">{val(r.motorKw)}</td>
                    <td className="mono">{val(r.grooves)}</td>
                    <td className="mono">{val(r.maxCapAt60Mwc)}</td>
                    <td>
                      <div className="pmm-row-actions">
                        <button className="pmm-btn" onClick={() => setDetailsRow(r)}>
                          <DetailsIcon /> Details
                        </button>
                        <button className="pmm-btn" onClick={() => setEditRow(r)}>
                          <EditIcon /> Edit
                        </button>
                        <button
                          className="pmm-btn pmm-btn-danger pmm-btn-icon"
                          onClick={() => setDeleteRow(r)}
                          title="Delete"
                          aria-label="Delete"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="pmm-empty-cell">
                      <EmptyState
                        compact
                        icon="search"
                        title="No rows match these filters"
                        description="Try a different keyword or clear some filters."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </div>
      )}

      {detailsRow && (
        <DetailsModal row={detailsRow} onClose={() => setDetailsRow(null)} />
      )}
      {editRow && (
        <EditModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={handleSaved}
        />
      )}
      {creating && (
        <CreateModal onClose={() => setCreating(false)} onCreated={handleCreated} />
      )}
      {deleteRow && (
        <DeleteModal
          row={deleteRow}
          onClose={() => setDeleteRow(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
};

// --- Details modal (includes belt-options sub-table) -----------------------

const DetailsModal = ({ row, onClose }: { row: PulleyMotorRow; onClose: () => void }) => {
  const [belts, setBelts] = useState<PulleyBeltRow[] | null>(null);
  const [beltsError, setBeltsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPulleyBeltRows(row.id)
      .then((b) => {
        if (!cancelled) setBelts(b);
      })
      .catch(() => {
        if (!cancelled) setBeltsError("Couldn't load belt options.");
      });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  return (
    <div className="pmm-modal-overlay" onClick={onClose}>
      <div
        className="pmm-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="pmm-modal-header">
          <h3>
            {row.model} · {row.motorRpm} rpm
          </h3>
          <button className="pmm-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="pmm-details-grid">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <span>{f.label}</span>
              <strong className={f.numeric ? "mono" : undefined}>
                {val(row[f.key])}
              </strong>
            </div>
          ))}
        </div>

        <h4
          style={{
            marginTop: 20,
            marginBottom: 8,
            fontSize: 13,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--fg-3)",
          }}
        >
          Belt Options
        </h4>
        {beltsError && <div className="pmm-form-error">{beltsError}</div>}
        {!belts && !beltsError && <p style={{ fontSize: 13 }}>Loading belt options…</p>}
        {belts && belts.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--fg-3)" }}>
            No belt options recorded for this motor option.
          </p>
        )}
        {belts && belts.length > 0 && (
          <div className="pmm-table-wrap" style={{ maxHeight: 260 }}>
            <table className="pmm-table">
              <thead>
                <tr>
                  <th>Target RPM</th>
                  <th>Pump Pulley</th>
                  <th>Motor Pulley</th>
                  <th>Actual RPM</th>
                  <th>Centre Dist</th>
                  <th>V-Belt No.</th>
                </tr>
              </thead>
              <tbody>
                {belts.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{val(b.targetRpm)}</td>
                    <td className="mono">{val(b.pmpPulley)}</td>
                    <td className="mono">{val(b.mtrPulley)}</td>
                    <td className="mono">{val(b.actualRpm)}</td>
                    <td className="mono">{val(b.centerDistance)}</td>
                    <td className="mono">{val(b.vBelt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pmm-modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Shared row-form (drives both Create and Edit) --------------------------

type RowFormProps = {
  title: string;
  initial: Record<string, string>;
  /** Initial belt-child rows to show. May be:
   *   - null: belts still loading (Edit mode, before fetch resolves)
   *   - array: the rows to render (Create passes [], Edit passes the fetched list)
   */
  initialBelts: BeltRowFormShape[] | null;
  onCancel: () => void;
  onSubmit: (
    form: Record<string, string>,
    belts: BeltRowFormShape[],
  ) => Promise<void>;
  submitLabel: string;
};

const RowForm = ({
  title,
  initial,
  initialBelts,
  onCancel,
  onSubmit,
  submitLabel,
}: RowFormProps) => {
  const [form, setForm] = useState(initial);
  const [belts, setBelts] = useState<BeltRowFormShape[]>(initialBelts ?? []);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Once the parent finishes fetching belts (Edit mode), swap them in — but
  // only if the user hasn't started editing already, to avoid clobbering.
  const beltsLoading = initialBelts === null;
  useEffect(() => {
    if (initialBelts !== null) {
      setBelts(initialBelts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBelts === null]);

  const set = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }));

  const setBelt = (
    key: string,
    field: Exclude<keyof BeltRowFormShape, "_key">,
    value: string,
  ) =>
    setBelts((prev) =>
      prev.map((b) => (b._key === key ? { ...b, [field]: value } : b)),
    );

  const addBelt = () => setBelts((prev) => [...prev, emptyBeltRow()]);
  const removeBelt = (key: string) =>
    setBelts((prev) => prev.filter((b) => b._key !== key));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!form.model.trim()) {
      setFormError("Model can't be empty.");
      return;
    }
    if (form.motorRpm.trim() === "" || Number.isNaN(Number(form.motorRpm))) {
      setFormError("Motor RPM is required and must be a number.");
      return;
    }
    // Every non-blank belt row must have a valid targetRpm — blank rows are
    // discarded silently server-side, but a filled row missing targetRpm is a
    // real user error and should be caught here.
    for (let i = 0; i < belts.length; i++) {
      const b = belts[i];
      const anyFilled = Object.values(b).some(
        (v, idx) => idx > 0 && String(v).trim() !== "",
      );
      if (!anyFilled) continue;
      if (b.targetRpm.trim() === "" || Number.isNaN(Number(b.targetRpm))) {
        setFormError(`Belt option #${i + 1}: target RPM is required.`);
        return;
      }
    }
    setSaving(true);
    setFormError("");
    try {
      await onSubmit(form, belts);
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't save."));
      setSaving(false);
    }
  };

  return (
    <div className="pmm-modal-overlay" onClick={onCancel}>
      <div
        className="pmm-modal"
        style={{ maxWidth: 880 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="pmm-modal-header">
          <h3>{title}</h3>
          <button className="pmm-modal-close" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          {formError && (
        <div className="pmm-form-error">
          <AlertIcon /><span>{formError}</span>
        </div>
      )}
          <div className="pmm-form-grid">
            {FIELDS.map((f) => (
              <div key={f.key} className="pmm-field">
                <label>
                  {f.label}
                  {f.required ? " *" : ""}
                </label>
                <input
                  type={f.numeric ? "number" : "text"}
                  step={f.numeric ? "any" : undefined}
                  value={form[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>

          {/* Belt Options — inline editable sub-table */}
          <div
            style={{
              marginTop: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <h4
              style={{
                fontSize: 13,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--fg-3)",
              }}
            >
              Belt Options
            </h4>
            <button type="button" className="pmm-btn" onClick={addBelt}>
              + Add belt
            </button>
          </div>

          {beltsLoading && (
            <p style={{ fontSize: 13, marginTop: 8 }}>Loading belt options…</p>
          )}

          {!beltsLoading && belts.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--fg-3)", marginTop: 8 }}>
              No belt options yet — click <b>+ Add belt</b> to add one.
            </p>
          )}

          {!beltsLoading && belts.length > 0 && (
            <div className="pmm-table-wrap" style={{ marginTop: 8, maxHeight: 320 }}>
              <table className="pmm-table">
                <thead>
                  <tr>
                    {BELT_FIELDS.map((f) => (
                      <th key={f.key}>
                        {f.label}
                        {f.required ? " *" : ""}
                      </th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {belts.map((b) => (
                    <tr key={b._key}>
                      {BELT_FIELDS.map((f) => (
                        <td key={f.key} style={{ padding: 4 }}>
                          <input
                            type="number"
                            step="any"
                            style={{
                              width: 90,
                              padding: "6px 8px",
                              border: "1px solid var(--line)",
                              borderRadius: 6,
                              background: "var(--bg-elev)",
                              color: "var(--fg)",
                              fontSize: 13,
                            }}
                            value={b[f.key]}
                            onChange={(e) => setBelt(b._key, f.key, e.target.value)}
                          />
                        </td>
                      ))}
                      <td style={{ padding: 4, textAlign: "right" }}>
                        <button
                          type="button"
                          className="pmm-btn pmm-btn-danger"
                          onClick={() => removeBelt(b._key)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pmm-modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <Spinner size="sm" inline />}
              {saving ? "Saving…" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- Create modal ----------------------------------------------------------

const CreateModal = ({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: PulleyMotorRow) => void;
}) => (
  <RowForm
    title="Add pulley row"
    initial={emptyForm()}
    initialBelts={[]}
    onCancel={onClose}
    submitLabel="Add Model Data"
    onSubmit={async (form, belts) => {
      // Send every field as a raw string — the API parses server-side.
      // motorRpm needs to be a real number to satisfy the required type.
      const values = {
        ...form,
        model: form.model.trim(),
        motorRpm: Number(form.motorRpm),
        belts: beltFormToApi(belts),
      } as unknown as PulleyMotorInsert;
      const created = await createPulleyMotorRow(values);
      onCreated(created);
    }}
  />
);

// --- Edit modal ------------------------------------------------------------

const EditModal = ({
  row,
  onClose,
  onSaved,
}: {
  row: PulleyMotorRow;
  onClose: () => void;
  onSaved: (updated: PulleyMotorRow) => void;
}) => {
  const [initialBelts, setInitialBelts] = useState<BeltRowFormShape[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPulleyBeltRows(row.id)
      .then((rows) => {
        if (cancelled) return;
        setInitialBelts(rows.map(beltToFormShape));
      })
      .catch(() => {
        // Fall back to an empty editable list rather than blocking edit — the
        // user can still fix the motor-option fields and add belt rows fresh.
        if (!cancelled) setInitialBelts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  return (
    <RowForm
      title={`Edit ${row.model}`}
      initial={Object.fromEntries(
        FIELDS.map((f) => [f.key, String(row[f.key] ?? "")])
      )}
      initialBelts={initialBelts}
      onCancel={onClose}
      submitLabel="Save changes"
      onSubmit={async (form, belts) => {
        const patch: PulleyMotorPatch = {};
        for (const f of FIELDS) {
          (patch as Record<string, string>)[f.key] = form[f.key];
        }
        // Presence of `belts` on PATCH replaces ALL existing children — see
        // the API route. We always send it here (even empty) so removals stick.
        patch.belts = beltFormToApi(belts);
        const updated = await updatePulleyMotorRow(row.id, patch);
        onSaved(updated);
      }}
    />
  );
};

// --- Delete confirm modal --------------------------------------------------

const DeleteModal = ({
  row,
  onClose,
  onDeleted,
}: {
  row: PulleyMotorRow;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) => {
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState("");

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setFormError("");
    try {
      await deletePulleyMotorRow(row.id);
      onDeleted(row.id);
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't delete this row."));
      setDeleting(false);
    }
  };

  return (
    <div className="pmm-modal-overlay" onClick={onClose}>
      <div
        className="pmm-modal pmm-modal-sm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="pmm-modal-header">
          <h3>Delete row?</h3>
          <button className="pmm-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="pmm-delete-text">
          Delete <strong>{row.model}</strong> ({row.motorRpm} rpm)?
          This also removes all its belt options (cascade). Affects the V-belt drive
          recommendation and can&apos;t be undone.
        </p>
        {formError && (
        <div className="pmm-form-error">
          <AlertIcon /><span>{formError}</span>
        </div>
      )}
        <div className="pmm-modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
            {deleting && <Spinner size="sm" inline />}
            {deleting ? "Deleting…" : "Delete row"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PulleyMasterPage;
