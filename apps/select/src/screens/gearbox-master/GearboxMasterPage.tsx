"use client";

import { useEffect, useMemo, useState } from "react";
import "../pump-model-master/PumpModelMasterPage.css";
import {
  createGearboxRow,
  deleteGearboxRow,
  listGearboxRows,
  updateGearboxRow,
  type GearboxMasterInsert,
  type GearboxMasterPatch,
  type GearboxMasterRow,
  type GearboxTableKey,
} from "../../services/gearboxMasterService";
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

type FieldDef = { key: keyof GearboxMasterRow; label: string; numeric: boolean; required?: boolean };

// power_rating_raw is deliberately excluded — ignored per spec, the server
// derives/keeps it in sync from power_rating_kw.
const FIELDS: FieldDef[] = [
  { key: "model", label: "Model", numeric: false, required: true },
  { key: "outputRpm", label: "Output RPM", numeric: true, required: true },
  { key: "gearBoxType", label: "Gear Box Type", numeric: false },
  { key: "powerRatingKw", label: "Power Rating (kW)", numeric: true },
  { key: "serviceFactor", label: "Service Factor", numeric: true },
  { key: "ratePerNos", label: "Rate per Nos.", numeric: true },
];

const TABLE_TABS: { key: GearboxTableKey; label: string }[] = [
  { key: "pbl", label: "PBL" },
  { key: "ptl", label: "PTL" },
  { key: "top-gear", label: "Top Gear" },
];

const val = (v: string | number | null) => (v === null || v === "" ? "—" : v);

// Default order: model, then output RPM ascending.
const defaultSort = (a: GearboxMasterRow, b: GearboxMasterRow) =>
  a.model.localeCompare(b.model, undefined, { numeric: true }) || Number(a.outputRpm) - Number(b.outputRpm);

const COLUMNS: ColumnSpec<GearboxMasterRow>[] = [
  { key: "model", label: "Model", get: (r) => r.model, filter: "select" },
  { key: "outputRpm", label: "Output RPM", get: (r) => r.outputRpm, numeric: true, filter: "range" },
  { key: "gearBoxType", label: "Gear Box Type", get: (r) => r.gearBoxType, filter: "select" },
  { key: "powerRatingKw", label: "Power Rating (kW)", get: (r) => r.powerRatingKw, numeric: true, filter: "range" },
  { key: "serviceFactor", label: "Service Factor", get: (r) => r.serviceFactor, numeric: true, filter: "range" },
  { key: "ratePerNos", label: "Rate per Nos.", get: (r) => r.ratePerNos, numeric: true, filter: "range" },
];

const errorMessage = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;

const emptyForm = (): Record<string, string> =>
  Object.fromEntries(FIELDS.map((f) => [f.key, ""]));

const GearboxMasterPage = () => {
  const [table, setTable] = useState<GearboxTableKey>("pbl");

  const [rows, setRows] = useState<GearboxMasterRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Search / sort / filter over every row (components/ui/tableControls.tsx).
  const controls = useTableControls(rows, COLUMNS, defaultSort);
  const filtered = controls.result;

  const [detailsRow, setDetailsRow] = useState<GearboxMasterRow | null>(null);
  const [editRow, setEditRow] = useState<GearboxMasterRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<GearboxMasterRow | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    controls.clearAll();
    listGearboxRows(table)
      .then(setRows)
      .catch(() => setError("Couldn't load gearbox master data."))
      .finally(() => setIsLoading(false));
  }, [table]);


  // 50 rows/page. Resets to page 1 whenever the search or table tab changes.
  const { page, setPage, from, to, pageSize } = usePagination(
    filtered.length,
    `${table}:${controls.resetKey}`,
    50
  );
  const paged = useMemo(() => filtered.slice(from, to), [filtered, from, to]);

  const resort = (list: GearboxMasterRow[]) =>
    [...list].sort((a, b) =>
      a.model === b.model
        ? Number(a.outputRpm) - Number(b.outputRpm)
        : a.model.localeCompare(b.model)
    );

  const handleCreated = (created: GearboxMasterRow) => {
    setRows((prev) => resort([...prev, created]));
    setCreating(false);
  };

  const handleSaved = (updated: GearboxMasterRow) => {
    setRows((prev) => resort(prev.map((r) => (r.id === updated.id ? updated : r))));
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
          <h1>Gearbox Master</h1>
          <p>
            PBL, PTL, and Top Gear master rows. Switch table, then add, edit, or delete
            a row, or view its full details. Power Rating (raw label) is not shown here.
          </p>
        </div>
        <div className="pmm-header-actions">
          <div className="pmm-search-wrap">
            <span className="pmm-search-icon"><SearchIcon /></span>
            <input
              type="search"
              className="pmm-search"
              placeholder="Search model, RPM, GB type, kW…"
              value={controls.search}
              onChange={(e) => controls.setSearch(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <PlusIcon /> Add row
          </button>
        </div>
      </div>

      <div className="pmm-tab-row" role="tablist">
        {TABLE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTable(t.key)}
            className={`pmm-tab ${table === t.key ? "pmm-tab-active" : ""}`}
            role="tab"
            aria-selected={table === t.key}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="pmm-panel">
          <div style={{ padding: 16 }}>
            <SkeletonRows rows={6} cols={5} />
          </div>
        </div>
      )}

      {!isLoading && error && (
        <div className="pmm-form-error"><AlertIcon /><span>{error}</span></div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <EmptyState
          icon="table"
          title="No rows yet"
          description={`The ${TABLE_TABS.find((t) => t.key === table)?.label} gearbox table is empty. Add the first row to seed it.`}
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
                  <SortTh controls={controls} colKey="outputRpm">Output RPM</SortTh>
                  <SortTh controls={controls} colKey="gearBoxType">Gear Box Type</SortTh>
                  <SortTh controls={controls} colKey="powerRatingKw">Power Rating (kW)</SortTh>
                  <SortTh controls={controls} colKey="serviceFactor">Service Factor</SortTh>
                  <SortTh controls={controls} colKey="ratePerNos">Rate per Nos.</SortTh>
                  <th className="pmm-actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id}>
                    <td className="pmm-model">{r.model}</td>
                    <td className="mono">{val(r.outputRpm)}</td>
                    <td>{val(r.gearBoxType)}</td>
                    <td className="mono">{val(r.powerRatingKw)}</td>
                    <td className="mono">{val(r.serviceFactor)}</td>
                    <td className="mono">{val(r.ratePerNos)}</td>
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
          table={table}
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={handleSaved}
        />
      )}
      {creating && (
        <CreateModal
          table={table}
          onClose={() => setCreating(false)}
          onCreated={handleCreated}
        />
      )}
      {deleteRow && (
        <DeleteModal
          table={table}
          row={deleteRow}
          onClose={() => setDeleteRow(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
};

// --- Details modal ---------------------------------------------------------

const DetailsModal = ({ row, onClose }: { row: GearboxMasterRow; onClose: () => void }) => (
  <div className="pmm-modal-overlay" onClick={onClose}>
    <div className="pmm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div className="pmm-modal-header">
        <h3>
          {row.model} · {val(row.outputRpm)} RPM
        </h3>
        <button className="pmm-modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="pmm-details-grid">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <span>{f.label}</span>
            <strong className={f.numeric ? "mono" : undefined}>{val(row[f.key])}</strong>
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

// --- Create modal ----------------------------------------------------------

const CreateModal = ({
  table,
  onClose,
  onCreated,
}: {
  table: GearboxTableKey;
  onClose: () => void;
  onCreated: (created: GearboxMasterRow) => void;
}) => {
  const [form, setForm] = useState<Record<string, string>>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const set = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!form.model.trim()) {
      setFormError("Model can't be empty.");
      return;
    }
    if (form.outputRpm.trim() === "" || Number.isNaN(Number(form.outputRpm))) {
      setFormError("Output RPM is required and must be a number.");
      return;
    }
    setSaving(true);
    setFormError("");
    const values: Record<string, string> = { ...form, model: form.model.trim() };
    try {
      const created = await createGearboxRow(table, values as unknown as GearboxMasterInsert);
      onCreated(created);
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't add row."));
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
          <h3>Add {TABLE_TABS.find((t) => t.key === table)?.label} row</h3>
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
          <div className="pmm-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <Spinner size="sm" inline />}
              {saving ? "Adding…" : "Add row"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- Edit modal ------------------------------------------------------------

const EditModal = ({
  table,
  row,
  onClose,
  onSaved,
}: {
  table: GearboxTableKey;
  row: GearboxMasterRow;
  onClose: () => void;
  onSaved: (updated: GearboxMasterRow) => void;
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
    if (!form.model.trim()) {
      setFormError("Model can't be empty.");
      return;
    }
    if (form.outputRpm.trim() === "" || Number.isNaN(Number(form.outputRpm))) {
      setFormError("Output RPM is required and must be a number.");
      return;
    }
    setSaving(true);
    setFormError("");
    const patch: GearboxMasterPatch = {};
    for (const f of FIELDS) {
      (patch as Record<string, string>)[f.key] = form[f.key];
    }
    try {
      const updated = await updateGearboxRow(table, row.id, patch);
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
          <h3>Edit {row.model}</h3>
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
                <label>{f.label}</label>
                <input
                  type={f.numeric ? "number" : "text"}
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
  table,
  row,
  onClose,
  onDeleted,
}: {
  table: GearboxTableKey;
  row: GearboxMasterRow;
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
      await deleteGearboxRow(table, row.id);
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
          Delete <strong>{row.model}</strong> at <strong>{val(row.outputRpm)} RPM</strong>?
          This permanently removes the row and can&apos;t be undone.
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

export default GearboxMasterPage;
