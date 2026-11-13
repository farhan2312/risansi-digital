"use client";

import { useEffect, useMemo, useState } from "react";
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
/** A sub-section heading inside a dialog (Belt Options). */
const SUBHEAD = "text-[11px] font-semibold tracking-wide text-muted-foreground uppercase";
import { usePageTitle } from "../../components/layout/PageTitle";

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
  // Heading in the top bar (user, 2026-11-13).
  usePageTitle("Pulley Master", "Every (model, motor RPM) row from the pulley/motor master. Edit or delete a row, or view its full details including the belt options.");
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
    <div className="min-h-full bg-background">
    <div className="w-full px-4 pt-4 pb-10 sm:px-6 min-[1101px]:px-0">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <div className="w-full sm:w-[280px]">
          <Input
            type="search"
            icon={<SearchIcon />}
            placeholder="Search model, RPM, kW, groove…"
            value={controls.search}
            onChange={(e) => controls.setSearch(e.target.value)}
          />
        </div>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon /> Add Model Data
        </Button>
      </div>

      {isLoading && (
        <Card className="p-4">
          <SkeletonRows rows={8} cols={5} />
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
            title="No pulley rows yet"
            description="The pulley master is empty. Add the first row to seed it — belt options can be added inline as children."
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
                  <SortTh controls={controls} colKey="model" className={TH}>Model</SortTh>
                  <SortTh controls={controls} colKey="motorRpm" className={TH}>Motor RPM</SortTh>
                  <SortTh controls={controls} colKey="motorHp" className={TH}>Motor HP</SortTh>
                  <SortTh controls={controls} colKey="motorKw" className={TH}>Motor kW</SortTh>
                  <SortTh controls={controls} colKey="grooves" className={TH}>Grooves</SortTh>
                  <SortTh controls={controls} colKey="maxCapAt60Mwc" className={TH}>Max Cap @ 60 MWC</SortTh>
                  <th className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paged.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-muted/50">
                    <td className={`${TD} font-mono font-semibold text-primary`}>{r.model}</td>
                    <td className={NUM}>{val(r.motorRpm)}</td>
                    <td className={NUM}>{val(r.motorHp)}</td>
                    <td className={NUM}>{val(r.motorKw)}</td>
                    <td className={NUM}>{val(r.grooves)}</td>
                    <td className={NUM}>{val(r.maxCapAt60Mwc)}</td>
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
                    <td colSpan={7} className="px-3 py-6">
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* Read only: a click outside closes it, as before. */}
      <DialogContent size="lg" onInteractOutside={() => {}}>
        <DialogHeader>
          <DialogTitle>
            {row.model} · {row.motorRpm} rpm
          </DialogTitle>
          <DialogDescription>Every field of this motor option, and its belt options</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key} className="min-w-0 border-b border-border pb-2">
                <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{f.label}</dt>
                <dd className={`mt-0.5 text-[13px] text-foreground ${f.numeric ? "font-mono tabular-nums" : "font-medium"}`}>{val(row[f.key])}</dd>
              </div>
            ))}
          </dl>

          <div className="space-y-2">
            <h4 className={SUBHEAD}>Belt Options</h4>
            {beltsError && <Alert>{beltsError}</Alert>}
            {!belts && !beltsError && <p className="text-[12.5px] text-muted-foreground">Loading belt options…</p>}
            {belts && belts.length === 0 && <p className="text-[12.5px] text-muted-foreground">No belt options recorded for this motor option.</p>}
            {belts && belts.length > 0 && (
              <div className="max-h-[260px] overflow-auto rounded-md border border-border">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      <th className={TH}>Target RPM</th>
                      <th className={TH}>Pump Pulley</th>
                      <th className={TH}>Motor Pulley</th>
                      <th className={TH}>Actual RPM</th>
                      <th className={TH}>Centre Dist</th>
                      <th className={TH}>V-Belt No.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {belts.map((b) => (
                      <tr key={b.id} className="hover:bg-muted/50">
                        <td className={NUM}>{val(b.targetRpm)}</td>
                        <td className={NUM}>{val(b.pmpPulley)}</td>
                        <td className={NUM}>{val(b.mtrPulley)}</td>
                        <td className={NUM}>{val(b.actualRpm)}</td>
                        <td className={NUM}>{val(b.centerDistance)}</td>
                        <td className={NUM}>{val(b.vBelt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent size="xl" className="max-w-[880px]">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Model and Motor RPM are required; each belt option needs its target RPM.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {formError && (
              <Alert className="flex items-center gap-2 [&_svg]:size-4">
                <AlertIcon />
                <span>{formError}</span>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <Field key={f.key} label={f.label} required={f.required} htmlFor={`pulley-${f.key}`}>
                  <Input
                    id={`pulley-${f.key}`}
                    type={f.numeric ? "number" : "text"}
                    step={f.numeric ? "any" : undefined}
                    value={form[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                </Field>
              ))}
            </div>

            {/* Belt Options — inline editable sub-table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h4 className={SUBHEAD}>Belt Options</h4>
                <Button variant="outline" size="sm" onClick={addBelt}>
                  <PlusIcon /> Add belt
                </Button>
              </div>

              {beltsLoading && <p className="text-[12.5px] text-muted-foreground">Loading belt options…</p>}

              {!beltsLoading && belts.length === 0 && (
                <p className="text-[12.5px] text-muted-foreground">
                  No belt options yet — click <b className="font-semibold text-foreground">Add belt</b> to add one.
                </p>
              )}

              {!beltsLoading && belts.length > 0 && (
                <div className="max-h-[320px] overflow-auto rounded-md border border-border">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr>
                        {BELT_FIELDS.map((f) => (
                          <th key={f.key} className={TH}>
                            {f.label}
                            {f.required && <span className="ml-0.5 text-destructive">*</span>}
                          </th>
                        ))}
                        <th className={TH}>
                          <span className="sr-only">Remove</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {belts.map((b) => (
                        <tr key={b._key}>
                          {BELT_FIELDS.map((f) => (
                            <td key={f.key} className="p-1">
                              <Input
                                type="number"
                                step="any"
                                aria-label={f.label}
                                className="h-7 w-[90px] font-mono tabular-nums"
                                value={b[f.key]}
                                onChange={(e) => setBelt(b._key, f.key, e.target.value)}
                              />
                            </td>
                          ))}
                          <td className="p-1 text-right">
                            <Button variant="ghost-destructive" size="sm" onClick={() => removeBelt(b._key)}>
                              <TrashIcon /> Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner size="sm" inline />}
              {saving ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
    <ConfirmDialog
      open
      title="Delete row?"
      description={
        <>
          Delete <strong>{row.model}</strong> ({row.motorRpm} rpm)? This also removes all its belt options (cascade). Affects the V-belt drive
          recommendation and can&apos;t be undone.
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
      {formError && (
        <Alert className="flex items-center gap-2 [&_svg]:size-4">
          <AlertIcon />
          <span>{formError}</span>
        </Alert>
      )}
    </ConfirmDialog>
  );
};

export default PulleyMasterPage;
