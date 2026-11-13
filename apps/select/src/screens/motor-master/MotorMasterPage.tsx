"use client";

import { useEffect, useMemo, useState } from "react";
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
import { PlusIcon, SearchIcon, DetailsIcon, EditIcon, TrashIcon, AlertIcon } from "../../components/ui/adminIcons";
// shadcn/ui (user, 2026-11-13: the master pages in the new look, branch select-shadcn).
import { Button } from "@/components/shadcn/button";
import { Card } from "@/components/shadcn/card";
import { Input } from "@/components/shadcn/input";
import { Alert, Field } from "@/components/shadcn/field";
import { ConfirmDialog } from "@/components/shadcn/alert-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";

/** Table heading cell (also given to SortTh, whose button inherits it). */
const TH = "sticky top-0 z-[1] border-b border-border bg-muted px-3 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase";
const TD = "px-3 py-2 align-middle";
const NUM = `${TD} font-mono tabular-nums text-foreground`;
import { usePageTitle } from "../../components/layout/PageTitle";

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
  // Heading in the top bar (user, 2026-11-13).
  usePageTitle("Motor Master", "Motor price comparison across Siemens / ABB / CGL / Havells (IE2, 1500 RPM) — one row per motor rating and brand. Edit or delete a row, or view its full details.");
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
    <div className="min-h-full bg-background">
    <div className="w-full px-4 pt-4 pb-10 sm:px-6 min-[1101px]:px-0">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <div className="w-full sm:w-[280px]">
          <Input
            type="search"
            icon={<SearchIcon />}
            placeholder="Search brand, type, frame, kW…"
            value={controls.search}
            onChange={(e) => controls.setSearch(e.target.value)}
          />
        </div>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon /> Add Motor
        </Button>
      </div>

      {isLoading && (
        <Card className="p-4">
          <SkeletonRows rows={8} cols={7} />
        </Card>
      )}

      {!isLoading && error && (
        <Alert className="flex items-center gap-2 [&_svg]:size-4">
          <AlertIcon />
          <span>{error}</span>
        </Alert>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <Card>
          <EmptyState
            icon="table"
            title="No motor rows yet"
            description="Add the first row to start populating the motor master."
            action={
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> Add first row
              </Button>
            }
          />
        </Card>
      )}

      {!isLoading && !error && rows.length > 0 && (
        <Card className="overflow-hidden">
          <FilterBar controls={controls} columns={COLUMNS} total={rows.length} />
          <div className="max-h-[calc(100vh-260px)] overflow-auto border-t border-border">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <SortTh controls={controls} colKey="brand" className={TH}>Brand</SortTh>
                  <SortTh controls={controls} colKey="motorKw" className={TH}>Motor kW</SortTh>
                  <SortTh controls={controls} colKey="motorHp" className={TH}>Motor HP</SortTh>
                  <SortTh controls={controls} colKey="motorRpm" className={TH}>RPM</SortTh>
                  <SortTh controls={controls} colKey="motorType" className={TH}>Motor Type</SortTh>
                  <SortTh controls={controls} colKey="frameSize" className={TH}>Frame Size</SortTh>
                  <SortTh controls={controls} colKey="lpPrice" className={TH}>LP Price</SortTh>
                  <SortTh controls={controls} colKey="finalPrice" className={TH}>Final Price</SortTh>
                  <SortTh controls={controls} colKey="effectiveDate" className={TH}>Effective Date</SortTh>
                  <th className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paged.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-muted/50">
                    <td className={`${TD} font-medium text-foreground`}>{val(r.brand)}</td>
                    <td className={NUM}>{val(r.motorKw)}</td>
                    <td className={NUM}>{val(r.motorHp)}</td>
                    <td className={NUM}>{val(r.motorRpm)}</td>
                    <td className={NUM}>{val(r.motorType)}</td>
                    <td className={NUM}>{val(r.frameSize)}</td>
                    <td className={NUM}>{val(r.lpPrice)}</td>
                    <td className={NUM}>{val(r.finalPrice)}</td>
                    <td className={NUM}>{fmtDate(r.effectiveDate)}</td>
                    <td className={TD}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDetailsRow(r)}>
                          <DetailsIcon /> Details
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditRow(r)}>
                          <EditIcon /> Edit
                        </Button>
                        <Button variant="ghost-destructive" size="icon-sm" onClick={() => setDeleteRow(r)} title="Delete" aria-label="Delete">
                          <TrashIcon />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-6">
                      <EmptyState compact icon="search" title="No rows match these filters" description="Try a different keyword or clear some filters." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border bg-muted/40">
            <Pagination page={page} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} />
          </div>
        </Card>
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
    </div>
  );
};

// --- Details modal ---------------------------------------------------------

const DetailsModal = ({ row, onClose }: { row: MotorMasterRow; onClose: () => void }) => (
  <Dialog open onOpenChange={(o) => !o && onClose()}>
    {/* Read only: a click outside closes it, as before. */}
    <DialogContent size="lg" onInteractOutside={() => {}}>
      <DialogHeader>
        <DialogTitle>
          {val(row.brand)} · {val(row.motorKw)} kW
        </DialogTitle>
        <DialogDescription>Every field of this motor row</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="min-w-0 border-b border-border pb-2">
              <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{f.label}</dt>
              <dd className={`mt-0.5 text-[13px] text-foreground ${f.numeric || f.date ? "font-mono tabular-nums" : "font-medium"}`}>
                {f.date ? fmtDate(row[f.key] as string | null) : val(row[f.key])}
              </dd>
            </div>
          ))}
        </dl>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

// --- shared form validation ------------------------------------------------

function validate(form: Record<string, string>): string | null {
  if (!form.brand.trim()) return "Brand can't be empty.";
  if (form.motorKw.trim() === "" || Number.isNaN(Number(form.motorKw)))
    return "Motor kW is required and must be a number.";
  return null;
}

/** The Add / Edit form: a dialog with the fields in two columns. */
const MotorForm = ({
  title,
  form,
  set,
  formError,
  saving,
  submitLabel,
  savingLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  form: Record<string, string>;
  set: (key: string, value: string) => void;
  formError: string;
  saving: boolean;
  submitLabel: string;
  savingLabel: string;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) => (
  <Dialog open onOpenChange={(o) => !o && onClose()}>
    <DialogContent size="lg">
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Brand and Motor kW are required.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError && (
            <Alert className="flex items-center gap-2 [&_svg]:size-4">
              <AlertIcon />
              <span>{formError}</span>
            </Alert>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label} required={REQUIRED_KEYS.has(f.key)} htmlFor={`motor-${f.key}`}>
                <Input
                  id={`motor-${f.key}`}
                  type={f.date ? "date" : f.numeric ? "number" : "text"}
                  step={f.numeric ? "any" : undefined}
                  value={form[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </Field>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Spinner size="sm" inline />}
            {saving ? savingLabel : submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
);

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
    <MotorForm
      title="Add motor row"
      form={form}
      set={set}
      formError={formError}
      saving={saving}
      submitLabel="Add motor"
      savingLabel="Adding…"
      onSubmit={handleCreate}
      onClose={onClose}
    />
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
    <MotorForm
      title={`Edit ${val(row.brand)} · ${val(row.motorKw)} kW`}
      form={form}
      set={set}
      formError={formError}
      saving={saving}
      submitLabel="Save changes"
      savingLabel="Saving…"
      onSubmit={handleSave}
      onClose={onClose}
    />
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
    <ConfirmDialog
      open
      title="Delete row?"
      description={
        <>
          Delete <strong>{val(row.brand)}</strong> at <strong>{val(row.motorKw)} kW</strong>
          {row.frameSize ? <> (<strong>{row.frameSize}</strong>)</> : null}? This permanently removes the row and can&apos;t be undone.
        </>
      }
      confirmLabel={
        <>
          {deleting && <Spinner size="sm" inline />}
          {deleting ? "Deleting…" : "Delete row"}
        </>
      }
      tone="danger"
      busy={deleting}
      onConfirm={handleDelete}
      onClose={onClose}
    >
      {formError && <Alert>{formError}</Alert>}
    </ConfirmDialog>
  );
};

export default MotorMasterPage;
