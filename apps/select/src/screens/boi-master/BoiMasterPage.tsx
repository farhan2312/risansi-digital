"use client";

import { useEffect, useMemo, useState } from "react";

import PageHeader from "../../components/ui/PageHeader";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { VFD_FIELDS } from "../../lib/boi-vfd";
import { formatInr, vfdNetPrice } from "../../lib/commercial";
import BoiTableTab from "./BoiTableTab";
import {
  DeleteConfirm,
  FieldGrid,
  Modal,
  errorMessage,
  formFromRow,
} from "./boiUi";
import { Button } from "@/components/shadcn/button";
import { Card } from "@/components/shadcn/card";
import { Input } from "@/components/shadcn/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs";
import { Alert } from "@/components/shadcn/field";
import {
  createBoiVfd,
  deleteBoiVfd,
  listBoiVfd,
  updateBoiVfd,
  type BoiVfdInput,
  type BoiVfdRow,
} from "../../services/boiMasterService";

// BOI Master — bought-out item price lists, one tab per item type (more BOI
// items get their own tab later):
//   VFD  boi_vfd, docs/BOI "VFD PRICE LIST 01-05-26 Dis 66.5 %"; the Commercial
//        Summary's VFD row picks from it by motor kW.
//   DRP        RTD probe / RTD panel prices; the DRP row suggests probe + panel.
//   Shaft Dia  shaft dia per pump model (the DRP probe is sized from it).

const TABS = [
  { key: "vfd", label: "VFD" },
  { key: "drp", label: "DRP" },
  { key: "shaft", label: "Shaft Dia" },
  { key: "mechseal", label: "Mech Seal" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const num = (v: string | null) => (v === null || v === "" ? null : Number(v));
const show = (v: string | null) => (v === null || v === "" ? "—" : String(Number(v)));

export default function BoiMasterPage() {
  const [tab, setTab] = useState<TabKey>("vfd");
  return (
    <div className="min-h-full bg-background">
    <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-10 sm:px-6 min-[1101px]:px-0">
      <PageHeader
        icon={<DatabaseIcon />}
        title="BOI Master"
        subtitle="Bought-out item price lists used by the Commercial Summary"
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList aria-label="BOI item type">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>
      {tab === "vfd" && <VfdTab />}
      {tab === "drp" && (
        <BoiTableTab
          tab="drp"
          intro="DRP (Dry Run Protection) per pump = RTD probe (smallest size ≥ the pump model's shaft dia, from the Shaft Dia tab) + RTD panel. The Commercial Summary suggests it for every tag."
        />
      )}
      {tab === "mechseal" && (
        <BoiTableTab
          tab="mechseal"
          intro="Mechanical seal prices (ACME). The Commercial Summary's Mechanical Seal row suggests the price from the Sealing step's seal type, MOC (SS304 / SS316) and SiC face, and the pump's shaft dia."
        />
      )}
      {tab === "shaft" && (
        <BoiTableTab
          tab="shaft"
          intro="Shaft dia of every pump model. Used to size the DRP probe; a model with a blank shaft dia gets no DRP suggestion."
        />
      )}
    </div>
    </div>
  );
}

const DatabaseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
    <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
  </svg>
);

function VfdTab() {
  const [rows, setRows] = useState<BoiVfdRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<BoiVfdRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<BoiVfdRow | null>(null);

  useEffect(() => {
    listBoiVfd()
      .then(setRows)
      .catch(() => {
        setLoadError("Couldn't load the VFD list.");
        setRows([]);
      });
  }, []);

  const sorted = (list: BoiVfdRow[]) =>
    [...list].sort(
      (a, b) =>
        (num(a.pnKw) ?? Infinity) - (num(b.pnKw) ?? Infinity) ||
        (num(a.listPrice) ?? Infinity) - (num(b.listPrice) ?? Infinity) ||
        a.driveDescription.localeCompare(b.driveDescription),
    );

  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!rows) return [];
    return rows.filter((r) => {
      const hay = [r.make, r.series, r.driveDescription, r.frame, r.pnKw, r.pldKw, r.phdKw].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, search]);

  const head = rows?.[0];

  return (
    <Card className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-foreground">Variable Frequency Drives</h2>
          <p className="text-[12px] text-muted-foreground">
            {head
              ? [head.make, head.series, head.supply, head.priceListDate && `list of ${head.priceListDate}`]
                  .filter(Boolean)
                  .join(" · ")
              : "Price list rows"}
            {" · "}net = list × (1 − discount%) + BOP extra · the Commercial Summary picks by motor kW
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-[220px]">
            <Input
              type="search"
              icon={<Search />}
              placeholder="Search drive, frame, kW…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search VFDs"
            />
          </div>
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add VFD
          </Button>
        </div>
      </header>

      {rows === null && <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Loading…</p>}
      {loadError && <p className="px-4 py-8 text-center text-[13px] font-medium text-destructive">{loadError}</p>}
      {rows && !loadError && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1060px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                <th rowSpan={2} className="px-3 py-2 font-medium">Drive Description</th>
                <th rowSpan={2} className="px-2 py-2 font-medium">Frame</th>
                <th colSpan={2} className="border-l border-border px-2 py-1.5 text-center font-medium">Nominal Use</th>
                <th colSpan={2} className="border-l border-border px-2 py-1.5 text-center font-medium">Light Duty</th>
                <th colSpan={2} className="border-l border-border px-2 py-1.5 text-center font-medium">Heavy Duty</th>
                <th rowSpan={2} className="border-l border-border px-2 py-2 text-right font-medium">List Price</th>
                <th rowSpan={2} className="px-2 py-2 text-right font-medium">Disc.</th>
                <th rowSpan={2} className="px-2 py-2 text-right font-medium">BOP Extra</th>
                <th rowSpan={2} className="px-2 py-2 text-right font-medium">Net Price</th>
                <th rowSpan={2} className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
              <tr className="border-b border-border bg-muted/60 text-[11px] text-muted-foreground">
                {["P_N kW", "I_N A", "P_LD kW", "I_LD A", "P_HD kW", "I_HD A"].map((h, i) => (
                  <th key={h} className={`px-2 py-1 text-right font-medium ${i % 2 === 0 ? "border-l border-border" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-muted/50">
                  <td className="px-3 py-2 font-mono text-foreground" title={r.remarks ?? undefined}>
                    {r.driveDescription}
                    {r.remarks && <span className="ml-1 text-warning">*</span>}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{r.frame ?? "—"}</td>
                  {[r.pnKw, r.inA, r.pldKw, r.ildA, r.phdKw, r.ihdA].map((v, i) => (
                    <td key={i} className={`px-2 py-2 text-right font-mono text-foreground tabular-nums ${i % 2 === 0 ? "border-l border-border" : ""}`}>
                      {show(v)}
                    </td>
                  ))}
                  <td className="border-l border-border px-2 py-2 text-right font-mono text-foreground tabular-nums">
                    {formatInr(num(r.listPrice))}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-muted-foreground tabular-nums">
                    {r.discountPct === null ? "—" : `${Number(r.discountPct)}%`}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-muted-foreground tabular-nums">{formatInr(num(r.bopExtra))}</td>
                  <td className="px-2 py-2 text-right font-mono font-semibold text-foreground tabular-nums">
                    {formatInr(vfdNetPrice(num(r.listPrice), num(r.discountPct), num(r.bopExtra)))}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => setEditing(r)}>
                        <Pencil /> Edit
                      </Button>
                      <Button
                        variant="ghost-destructive"
                        size="icon-sm"
                        onClick={() => setDeleting(r)}
                        aria-label={`Delete ${r.driveDescription}`}
                        title="Delete"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                    {rows.length === 0 ? "No VFDs yet — add the first one." : "No VFD matches that search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <VfdFormModal
          row={editing === "new" ? null : editing}
          defaults={head}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setRows((prev) => sorted([...(prev ?? []).filter((r) => r.id !== saved.id), saved]));
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          what="VFD"
          name={deleting.driveDescription}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteBoiVfd(deleting.id);
            setRows((prev) => (prev ?? []).filter((r) => r.id !== deleting.id));
            setDeleting(null);
          }}
        />
      )}
    </Card>
  );
}

function VfdFormModal({
  row,
  defaults,
  onClose,
  onSaved,
}: {
  row: BoiVfdRow | null;
  /** A new row starts with the list's make / series / supply / discount / BOP / date. */
  defaults: BoiVfdRow | undefined;
  onClose: () => void;
  onSaved: (row: BoiVfdRow) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(() =>
    formFromRow(
      VFD_FIELDS,
      row ?? {
        make: defaults?.make ?? "",
        series: defaults?.series,
        supply: defaults?.supply,
        discountPct: defaults?.discountPct,
        bopExtra: defaults?.bopExtra,
        priceListDate: defaults?.priceListDate,
      },
    ),
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const net = vfdNetPrice(
    form.listPrice ? Number(form.listPrice) : null,
    form.discountPct ? Number(form.discountPct) : null,
    form.bopExtra ? Number(form.bopExtra) : null,
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const missing = VFD_FIELDS.find((f) => f.required && !form[f.key].trim());
    if (missing) {
      setFormError(`${missing.label} is required.`);
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const values = form as BoiVfdInput;
      onSaved(row ? await updateBoiVfd(row.id, values) : await createBoiVfd(values));
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't save this VFD."));
      setSaving(false);
    }
  };

  return (
    <Modal title={row ? `Edit ${row.driveDescription}` : "Add VFD"} onClose={onClose}>
      <form onSubmit={submit} className="flex min-h-0 flex-col">
        <div className="grid min-h-0 grid-cols-1 gap-3 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          <FieldGrid fields={VFD_FIELDS} form={form} onChange={(k, v) => setForm((p) => ({ ...p, [k]: v }))} />
          <p className="rounded-md bg-muted/60 px-3 py-2 text-[12.5px] text-muted-foreground sm:col-span-2">
            Net price: <span className="font-mono font-semibold text-foreground tabular-nums">{formatInr(net)}</span>
          </p>
          {formError && <Alert className="sm:col-span-2">{formError}</Alert>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : row ? "Save changes" : "Add VFD"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
