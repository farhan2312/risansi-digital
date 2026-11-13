"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createPumpModelRow,
  deletePumpModelRow,
  listPumpModelRows,
  updatePumpModelRow,
  type PumpModelInsert,
  type PumpModelPatch,
  type PumpModelRow,
} from "../../services/pumpModelMasterService";
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
import { usePageTitle } from "../../components/layout/PageTitle";
// shadcn/ui (user, 2026-11-13: master pages in the new look, branch select-shadcn).
import { Button } from "@/components/shadcn/button";
import { Card } from "@/components/shadcn/card";
import { Input } from "@/components/shadcn/input";
import { Alert, Field } from "@/components/shadcn/field";
import { ConfirmDialog } from "@/components/shadcn/alert-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";

type FieldDef = { key: keyof PumpModelRow; label: string; numeric: boolean };

// Editable columns, in form/details order. `id` is never editable.
const FIELDS: FieldDef[] = [
  { key: "model", label: "Model", numeric: false },
  { key: "stage", label: "Stage", numeric: true },
  { key: "headMwc", label: "Head (MWC)", numeric: true },
  { key: "voleMin", label: "VOLE Min", numeric: true },
  { key: "voleMax", label: "VOLE Max", numeric: true },
  { key: "mechEff", label: "Mech Eff", numeric: true },
  { key: "qth", label: "QTH", numeric: true },
  { key: "minKwExisting", label: "Min kW Existing", numeric: true },
  { key: "minStartingKwAt1Kg", label: "Min Starting kW @ 1kg", numeric: true },
  { key: "minKwTested", label: "Min kW Tested", numeric: true },
  { key: "minKwToBeTested", label: "Min kW To Be Tested", numeric: true },
  { key: "testingRemarks", label: "Testing Remarks", numeric: false },
  { key: "hardSolidMm", label: "Hard Solid (mm)", numeric: true },
  { key: "softSolidMm", label: "Soft Solid (mm)", numeric: true },
  { key: "sizeVisc0To1000In", label: "Size 0-1000 cP (in)", numeric: true },
  { key: "sizeVisc1000To3000In", label: "Size 1000-3000 cP (in)", numeric: true },
  { key: "sizeVisc3000To5000In", label: "Size 3000-5000 cP (in)", numeric: true },
  { key: "sizeVisc5000To10000In", label: "Size 5000-10000 cP (in)", numeric: true },
  { key: "sizeViscGt10000In", label: "Size >10000 cP (in)", numeric: true },
];

const val = (v: string | number | null) => (v === null || v === "" ? "—" : v);

// Table cells: a muted header row (sticky while the page scrolls), hairline rows.
const TH =
  "sticky top-0 z-10 border-b border-border bg-muted px-3 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase";
const TD = "border-b border-border px-3 py-2 align-middle whitespace-nowrap text-foreground";
const NUM = "font-mono tabular-nums";

// Default order: model family (Barrel -> H -> 2H -> 4H -> 8H), size within
// the family, then head ascending.
const defaultSort = (a: PumpModelRow, b: PumpModelRow) =>
  comparePumpModels(a.model, b.model) || Number(a.headMwc) - Number(b.headMwc);

// Search / sort / filter columns (see components/ui/tableControls.tsx).
const COLUMNS: ColumnSpec<PumpModelRow>[] = [
  { key: "family", label: "Family", get: (r) => pumpModelFamily(r.model), filter: "select", optionCompare: comparePumpFamilies },
  { key: "model", label: "Model", get: (r) => r.model, filter: "select", optionCompare: comparePumpModels, compare: defaultSort },
  { key: "stage", label: "Stage", get: (r) => r.stage, numeric: true, filter: "select" },
  { key: "headMwc", label: "Head (MWC)", get: (r) => r.headMwc, numeric: true, filter: "range" },
  { key: "voleMin", label: "VOLE Min", get: (r) => r.voleMin, numeric: true },
  { key: "voleMax", label: "VOLE Max", get: (r) => r.voleMax, numeric: true },
  { key: "mechEff", label: "Mech Eff", get: (r) => r.mechEff, numeric: true },
  { key: "qth", label: "QTH", get: (r) => r.qth, numeric: true, filter: "range" },
  { key: "minKwTested", label: "Min kW Tested", get: (r) => r.minKwTested, numeric: true, filter: "range" },
  { key: "testingRemarks", label: "Remarks", get: (r) => r.testingRemarks },
];

const errorMessage = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
  fallback;

const PumpModelMasterPage = () => {
  // Heading in the top bar (user, 2026-11-13).
  usePageTitle("Pump Model Master", "Every (model, head-point) row from the pump model master. Edit or delete a row, or view its full details.");
  const [rows, setRows] = useState<PumpModelRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detailsRow, setDetailsRow] = useState<PumpModelRow | null>(null);
  const [editRow, setEditRow] = useState<PumpModelRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<PumpModelRow | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    listPumpModelRows()
      .then(setRows)
      .catch(() => setError("Couldn't load pump model master data."))
      .finally(() => setIsLoading(false));
  }, []);

  const controls = useTableControls(rows, COLUMNS, defaultSort);
  const filtered = controls.result;

  // 50 rows/page. Resets to page 1 whenever the search, filters or sort
  // change so the user isn't stranded on an empty page beyond the new end.
  const { page, setPage, from, to, pageSize } = usePagination(
    filtered.length,
    controls.resetKey,
    50
  );
  const paged = useMemo(() => filtered.slice(from, to), [filtered, from, to]);

  const handleCreated = (created: PumpModelRow) => {
    setRows((prev) =>
      [...prev, created].sort((a, b) =>
        a.model === b.model
          ? Number(a.headMwc) - Number(b.headMwc)
          : a.model.localeCompare(b.model)
      )
    );
    setCreating(false);
  };

  const handleSaved = (updated: PumpModelRow) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setEditRow(null);
  };

  const handleDeleted = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setDeleteRow(null);
  };

  return (
    <div className="min-h-full bg-background">
      <div className="w-full px-4 pt-4 pb-10 sm:px-6 2xl:px-8">
        {/* Search and Add (the heading is in the top bar) */}
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <div className="w-full sm:w-[280px]">
            <Input
              type="search"
              icon={<SearchIcon />}
              placeholder="Search model, head, remarks…"
              value={controls.search}
              onChange={(e) => controls.setSearch(e.target.value)}
            />
          </div>
          <Button onClick={() => setCreating(true)}>
            <PlusIcon /> Add Model
          </Button>
        </div>

        {isLoading && (
          <Card className="p-4">
            <SkeletonRows rows={8} cols={6} />
          </Card>
        )}

        {!isLoading && error && (
          <Alert className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
            <AlertIcon />
            <span>{error}</span>
          </Alert>
        )}

        {!isLoading && !error && rows.length === 0 && (
          <Card>
            <EmptyState
              icon="table"
              title="No pump model rows yet"
              description="Add the first row to start populating the pump model master. The recommendation engine reads directly from this table."
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
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-[12.5px]">
                <thead>
                  <tr>
                    <SortTh controls={controls} colKey="model" className={TH}>Model</SortTh>
                    <SortTh controls={controls} colKey="stage" className={TH}>Stage</SortTh>
                    <SortTh controls={controls} colKey="headMwc" className={TH}>Head (MWC)</SortTh>
                    <SortTh controls={controls} colKey="voleMin" className={TH}>VOLE Min</SortTh>
                    <SortTh controls={controls} colKey="voleMax" className={TH}>VOLE Max</SortTh>
                    <SortTh controls={controls} colKey="mechEff" className={TH}>Mech Eff</SortTh>
                    <SortTh controls={controls} colKey="qth" className={TH}>QTH</SortTh>
                    <SortTh controls={controls} colKey="minKwTested" className={TH}>Min kW Tested</SortTh>
                    <SortTh controls={controls} colKey="testingRemarks" className={TH}>Remarks</SortTh>
                    <th className={`${TH} w-[1%]`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => (
                    <tr key={r.id} className="transition-colors hover:bg-muted/50">
                      <td className={`${TD} font-semibold text-primary`}>{r.model}</td>
                      <td className={`${TD} ${NUM}`}>{val(r.stage)}</td>
                      <td className={`${TD} ${NUM}`}>{val(r.headMwc)}</td>
                      <td className={`${TD} ${NUM}`}>{val(r.voleMin)}</td>
                      <td className={`${TD} ${NUM}`}>{val(r.voleMax)}</td>
                      <td className={`${TD} ${NUM}`}>{val(r.mechEff)}</td>
                      <td className={`${TD} ${NUM}`}>{val(r.qth)}</td>
                      <td className={`${TD} ${NUM}`}>{val(r.minKwTested)}</td>
                      <td className={`${TD} max-w-[240px] truncate text-muted-foreground`} title={r.testingRemarks ?? undefined}>
                        {val(r.testingRemarks)}
                      </td>
                      <td className={TD}>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setDetailsRow(r)}>
                            <DetailsIcon /> Details
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setEditRow(r)}>
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
                      <td colSpan={10} className="p-0">
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

        {detailsRow && <DetailsModal row={detailsRow} onClose={() => setDetailsRow(null)} />}
        {editRow && <EditModal row={editRow} onClose={() => setEditRow(null)} onSaved={handleSaved} />}
        {creating && <CreateModal onClose={() => setCreating(false)} onCreated={handleCreated} />}
        {deleteRow && <DeleteModal row={deleteRow} onClose={() => setDeleteRow(null)} onDeleted={handleDeleted} />}
      </div>
    </div>
  );
};

// --- Details modal ---------------------------------------------------------

const DetailsModal = ({ row, onClose }: { row: PumpModelRow; onClose: () => void }) => (
  <Dialog open onOpenChange={(o) => !o && onClose()}>
    {/* A click outside closes the details, as before (nothing to lose). */}
    <DialogContent size="lg" onInteractOutside={() => {}}>
      <DialogHeader>
        <DialogTitle>
          {row.model} · {val(row.headMwc)} MWC
        </DialogTitle>
        <DialogDescription>Every field of this row</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-0.5 rounded-md bg-muted/60 px-3 py-2">
              <span className="text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">{f.label}</span>
              <strong className={`text-[13px] font-semibold text-foreground ${f.numeric ? NUM : ""}`}>{val(row[f.key])}</strong>
            </div>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/** The add / edit form's fields, two columns. */
const FormFields = ({ form, set, required }: { form: Record<string, string>; set: (key: string, value: string) => void; required: boolean }) => (
  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
    {FIELDS.map((f) => (
      <Field key={f.key} label={f.label} htmlFor={`pmm-${f.key}`} required={required && (f.key === "model" || f.key === "headMwc")}>
        <Input
          id={`pmm-${f.key}`}
          type={f.numeric ? "number" : "text"}
          step={f.numeric ? "any" : undefined}
          value={form[f.key]}
          onChange={(e) => set(f.key, e.target.value)}
        />
      </Field>
    ))}
  </div>
);

// --- Create modal ----------------------------------------------------------

const CreateModal = ({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: PumpModelRow) => void;
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
    if (!form.model.trim()) {
      setFormError("Model can't be empty.");
      return;
    }
    if (form.headMwc.trim() === "" || Number.isNaN(Number(form.headMwc))) {
      setFormError("Head (MWC) is required and must be a number.");
      return;
    }
    setSaving(true);
    setFormError("");
    // Send every field as a raw string — the API's numOrNull/intOrNull handle
    // parsing and null-on-blank server-side, matching the PATCH flow.
    const values: Record<string, string> = { ...form, model: form.model.trim() };
    try {
      const created = await createPumpModelRow(values as unknown as PumpModelInsert);
      onCreated(created);
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't add model."));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={handleCreate} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Add pump model row</DialogTitle>
            <DialogDescription>Model and Head (MWC) are required; blank numbers are saved empty.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3.5">
            {formError && (
              <Alert className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
                <AlertIcon />
                <span>{formError}</span>
              </Alert>
            )}
            <FormFields form={form} set={set} required />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner size="sm" inline />}
              {saving ? "Adding…" : "Add model"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// --- Edit modal ------------------------------------------------------------

const EditModal = ({
  row,
  onClose,
  onSaved,
}: {
  row: PumpModelRow;
  onClose: () => void;
  onSaved: (updated: PumpModelRow) => void;
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
    if (form.headMwc.trim() === "" || Number.isNaN(Number(form.headMwc))) {
      setFormError("Head (MWC) is required and must be a number.");
      return;
    }
    setSaving(true);
    setFormError("");
    // Send every editable field (empty numeric/text becomes null server-side).
    const patch: PumpModelPatch = {};
    for (const f of FIELDS) {
      (patch as Record<string, string>)[f.key] = form[f.key];
    }
    try {
      const updated = await updatePumpModelRow(row.id, patch);
      onSaved(updated);
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't save changes."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Edit {row.model}</DialogTitle>
            <DialogDescription>Blank numbers are saved empty.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3.5">
            {formError && (
              <Alert className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
                <AlertIcon />
                <span>{formError}</span>
              </Alert>
            )}
            <FormFields form={form} set={set} required={false} />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner size="sm" inline />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// --- Delete confirm modal --------------------------------------------------

const DeleteModal = ({
  row,
  onClose,
  onDeleted,
}: {
  row: PumpModelRow;
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
      await deletePumpModelRow(row.id);
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
          Delete <strong>{row.model}</strong> at <strong>{val(row.headMwc)} MWC</strong>? This permanently removes the row and affects the
          recommendation engine. This can&apos;t be undone.
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

export default PumpModelMasterPage;
