"use client";

import { useEffect, useMemo, useState } from "react";
// Reuse the pump-model master's pmm-* styles — same flat-panel table/modal
// design system, no need for a second stylesheet.
import "../pump-model-master/PumpModelMasterPage.css";
import {
  createMotorMasterRow,
  deleteMotorMasterRow,
  listMotorMasterRows,
  updateMotorMasterRow,
  type MotorMasterInsert,
  type MotorMasterPatch,
  type MotorMasterRow,
} from "../../services/motorMasterService";
import EmptyState from "../../components/ui/EmptyState";
import { SkeletonRows } from "../../components/ui/Skeleton";
import Spinner from "../../components/ui/Spinner";
import Pagination, { usePagination } from "../../components/ui/Pagination";
import { FilterBar, SortTh, useTableControls, type ColumnSpec } from "../../components/ui/tableControls";
import {
  PlusIcon,
  SearchIcon,
  DetailsIcon,
  EditIcon,
  TrashIcon,
  AlertIcon,
} from "../../components/ui/adminIcons";

type FieldDef = { key: keyof MotorMasterRow; label: string; numeric: boolean; date?: boolean };

// Editable columns, in form/details order. `id` is never editable.
const FIELDS: FieldDef[] = [
  { key: "brand", label: "Brand", numeric: false },
  { key: "motorKw", label: "Motor kW", numeric: true },
  { key: "motorHp", label: "Motor HP", numeric: true },
  { key: "motorRpm", label: "Motor RPM", numeric: true },
  { key: "motorType", label: "Motor Type", numeric: false },
  { key: "mounting", label: "Mounting", numeric: false },
  { key: "frameSize", label: "Frame Size", numeric: false },
  { key: "lpPrice", label: "LP Price", numeric: true },
  { key: "finalPrice", label: "Final Price", numeric: true },
  { key: "effectiveDate", label: "Effective Date", numeric: false, date: true },
];

// Required identifiers (mirrors the API: brand + motorKw NOT nullable in intent).
const REQUIRED_KEYS = new Set<keyof MotorMasterRow>(["brand", "motorKw"]);

const val = (v: string | number | null) => (v === null || v === "" ? "—" : v);

// "2026-05-22" -> "22-05-2026", the way the price lists print it. Built from
// the parts, not new Date(), so it can't shift a day across time zones.
const fmtDate = (v: string | null): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};

// Group by rating (kW) ascending, then brand — matches the source sheet order.
const sortRows = (a: MotorMasterRow, b: MotorMasterRow) => {
  const ka = Number(a.motorKw);
  const kb = Number(b.motorKw);
  if (ka !== kb) return ka - kb;
  return String(a.brand ?? "").localeCompare(String(b.brand ?? ""));
};

const COLUMNS: ColumnSpec<MotorMasterRow>[] = [
  { key: "brand", label: "Brand", get: (r) => r.brand, filter: "select" },
  { key: "motorKw", label: "Motor kW", get: (r) => r.motorKw, numeric: true, filter: "select" },
  { key: "motorHp", label: "Motor HP", get: (r) => r.motorHp, numeric: true },
  { key: "motorRpm", label: "RPM", get: (r) => r.motorRpm, numeric: true, filter: "select" },
  { key: "motorType", label: "Motor Type", get: (r) => r.motorType, filter: "select" },
  { key: "frameSize", label: "Frame Size", get: (r) => r.frameSize, filter: "select" },
  { key: "mounting", label: "Mounting", get: (r) => r.mounting, filter: "select" },
  { key: "lpPrice", label: "LP Price", get: (r) => r.lpPrice, numeric: true },
  { key: "finalPrice", label: "Final Price", get: (r) => r.finalPrice, numeric: true, filter: "range" },
  { key: "effectiveDate", label: "Effective Date", get: (r) => r.effectiveDate },
];

const errorMessage = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
  fallback;

const MotorMasterPage = () => {
  const [rows, setRows] = useState<MotorMasterRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Search / sort / filter over every row (components/ui/tableControls.tsx).
  const controls = useTableControls(rows, COLUMNS, sortRows);
  const filtered = controls.result;

  const [detailsRow, setDetailsRow] = useState<MotorMasterRow | null>(null);
  const [editRow, setEditRow] = useState<MotorMasterRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<MotorMasterRow | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    listMotorMasterRows()
      .then(setRows)
      .catch(() => setError("Couldn't load motor master data."))
      .finally(() => setIsLoading(false));
  }, []);


  const { page, setPage, from, to, pageSize } = usePagination(
    filtered.length,
    controls.resetKey,
    50
  );
  const paged = useMemo(() => filtered.slice(from, to), [filtered, from, to]);

  const handleCreated = (created: MotorMasterRow) => {
    setRows((prev) => [...prev, created].sort(sortRows));
    setCreating(false);
  };

  const handleSaved = (updated: MotorMasterRow) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)).sort(sortRows));
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
          <h1>Motor Master</h1>
          <p>
            Motor price comparison across Siemens / ABB / CGL / Havells (IE2, 1500
            RPM) — one row per motor rating and brand. Edit or delete a row, or view
            its full details.
          </p>
        </div>
        <div className="pmm-header-actions">
          <div className="pmm-search-wrap">
            <span className="pmm-search-icon"><SearchIcon /></span>
            <input
              type="search"
              className="pmm-search"
              placeholder="Search brand, type, frame, kW…"
              value={controls.search}
              onChange={(e) => controls.setSearch(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <PlusIcon /> Add Motor
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="pmm-panel">
          <div style={{ padding: 16 }}>
            <SkeletonRows rows={8} cols={7} />
          </div>
        </div>
      )}

      {!isLoading && error && (
        <div className="pmm-form-error"><AlertIcon /><span>{error}</span></div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <EmptyState
          icon="table"
          title="No motor rows yet"
          description="Add the first row to start populating the motor master."
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
                  <SortTh controls={controls} colKey="brand">Brand</SortTh>
                  <SortTh controls={controls} colKey="motorKw">Motor kW</SortTh>
                  <SortTh controls={controls} colKey="motorHp">Motor HP</SortTh>
                  <SortTh controls={controls} colKey="motorRpm">RPM</SortTh>
                  <SortTh controls={controls} colKey="motorType">Motor Type</SortTh>
                  <SortTh controls={controls} colKey="frameSize">Frame Size</SortTh>
                  <SortTh controls={controls} colKey="lpPrice">LP Price</SortTh>
                  <SortTh controls={controls} colKey="finalPrice">Final Price</SortTh>
                  <SortTh controls={controls} colKey="effectiveDate">Effective Date</SortTh>
                  <th className="pmm-actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id}>
                    <td className="pmm-model">{val(r.brand)}</td>
                    <td className="mono">{val(r.motorKw)}</td>
                    <td className="mono">{val(r.motorHp)}</td>
                    <td className="mono">{val(r.motorRpm)}</td>
                    <td className="mono">{val(r.motorType)}</td>
                    <td className="mono">{val(r.frameSize)}</td>
                    <td className="mono">{val(r.lpPrice)}</td>
                    <td className="mono">{val(r.finalPrice)}</td>
                    <td className="mono">{fmtDate(r.effectiveDate)}</td>
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
                    <td colSpan={9} className="pmm-empty-cell">
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
        <CreateModal
          onClose={() => setCreating(false)}
          onCreated={handleCreated}
        />
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

// --- Details modal ---------------------------------------------------------

const DetailsModal = ({ row, onClose }: { row: MotorMasterRow; onClose: () => void }) => (
  <div className="pmm-modal-overlay" onClick={onClose}>
    <div className="pmm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div className="pmm-modal-header">
        <h3>
          {val(row.brand)} · {val(row.motorKw)} kW
        </h3>
        <button className="pmm-modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="pmm-details-grid">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <span>{f.label}</span>
            <strong className={f.numeric || f.date ? "mono" : undefined}>
              {f.date ? fmtDate(row[f.key] as string | null) : val(row[f.key])}
            </strong>
          </div>
        ))}
      </div>
      <div className="pmm-modal-actions">
        <button className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  </div>
);

// --- shared form validation ------------------------------------------------

function validate(form: Record<string, string>): string | null {
  if (!form.brand.trim()) return "Brand can't be empty.";
  if (form.motorKw.trim() === "" || Number.isNaN(Number(form.motorKw)))
    return "Motor kW is required and must be a number.";
  return null;
}

// --- Create modal ----------------------------------------------------------

const CreateModal = ({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: MotorMasterRow) => void;
}) => {
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, ""]))
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const set = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const invalid = validate(form);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setSaving(true);
    setFormError("");
    // Send every field as a raw string — the API's numOrNull/intOrNull/textOrNull
    // handle parsing and null-on-blank server-side.
    const values: Record<string, string> = { ...form, brand: form.brand.trim() };
    try {
      const created = await createMotorMasterRow(values as unknown as MotorMasterInsert);
      onCreated(created);
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't add motor row."));
      setSaving(false);
    }
  };

  return (
    <div className="pmm-modal-overlay" onClick={onClose}>
      <div
        className="pmm-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="pmm-modal-header">
          <h3>Add motor row</h3>
          <button className="pmm-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form onSubmit={handleCreate}>
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
                  {REQUIRED_KEYS.has(f.key) ? " *" : ""}
                </label>
                <input
                  type={f.date ? "date" : f.numeric ? "number" : "text"}
                  step={f.numeric ? "any" : undefined}
                  value={form[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="pmm-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <Spinner size="sm" inline />}
              {saving ? "Adding…" : "Add motor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- Edit modal ------------------------------------------------------------

const EditModal = ({
  row,
  onClose,
  onSaved,
}: {
  row: MotorMasterRow;
  onClose: () => void;
  onSaved: (updated: MotorMasterRow) => void;
}) => {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of FIELDS) initial[f.key] = String(row[f.key] ?? "");
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const set = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const invalid = validate(form);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setSaving(true);
    setFormError("");
    const patch: MotorMasterPatch = {};
    for (const f of FIELDS) {
      (patch as Record<string, string>)[f.key] = form[f.key];
    }
    try {
      const updated = await updateMotorMasterRow(row.id, patch);
      onSaved(updated);
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't save changes."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pmm-modal-overlay" onClick={onClose}>
      <div className="pmm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="pmm-modal-header">
          <h3>Edit {val(row.brand)} · {val(row.motorKw)} kW</h3>
          <button className="pmm-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form onSubmit={handleSave}>
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
                  {REQUIRED_KEYS.has(f.key) ? " *" : ""}
                </label>
                <input
                  type={f.date ? "date" : f.numeric ? "number" : "text"}
                  step={f.numeric ? "any" : undefined}
                  value={form[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="pmm-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <Spinner size="sm" inline />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- Delete confirm modal --------------------------------------------------

const DeleteModal = ({
  row,
  onClose,
  onDeleted,
}: {
  row: MotorMasterRow;
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
      await deleteMotorMasterRow(row.id);
      onDeleted(row.id);
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't delete this row."));
      setDeleting(false);
    }
  };

  return (
    <div className="pmm-modal-overlay" onClick={onClose}>
      <div className="pmm-modal pmm-modal-sm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="pmm-modal-header">
          <h3>Delete row?</h3>
          <button className="pmm-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="pmm-delete-text">
          Delete <strong>{val(row.brand)}</strong> at <strong>{val(row.motorKw)} kW</strong>
          {row.frameSize ? <> (<strong>{row.frameSize}</strong>)</> : null}? This
          permanently removes the row and can&apos;t be undone.
        </p>
        {formError && <div className="pmm-form-error">{formError}</div>}
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

export default MotorMasterPage;
