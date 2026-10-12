"use client";

import { useEffect, useMemo, useState } from "react";

import PageHeader from "../../components/ui/PageHeader";
import { EditIcon, PlusIcon, TrashIcon } from "../../components/ui/adminIcons";
import { VFD_FIELDS } from "../../lib/boi-vfd";
import { formatInr, vfdNetPrice } from "../../lib/commercial";
import BoiTableTab from "./BoiTableTab";
import {
  DeleteConfirm,
  FieldGrid,
  Modal,
  btnPrimary,
  btnSecondary,
  btnSm,
  errorMessage,
  formFromRow,
  inputCls,
} from "./boiUi";
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
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={<DatabaseIcon />}
        title="BOI Master"
        subtitle="Bought-out item price lists used by the Commercial Summary"
      >
        <div className="flex gap-1 px-5 pb-3" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                tab === t.key ? "bg-accent text-white" : "text-fg-2 hover:bg-sunk"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
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
    <section className="rounded-xl border border-line bg-paper">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-fg">Variable Frequency Drives</h2>
          <p className="text-[12px] text-fg-3">
            {head
              ? [head.make, head.series, head.supply, head.priceListDate && `list of ${head.priceListDate}`]
                  .filter(Boolean)
                  .join(" · ")
              : "Price list rows"}
            {" · "}net = list × (1 − discount%) + BOP extra · the Commercial Summary picks by motor kW
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            className={`${inputCls} w-[220px]`}
            placeholder="Search drive, frame, kW…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search VFDs"
          />
          <button type="button" className={btnPrimary} onClick={() => setEditing("new")}>
            <PlusIcon /> Add VFD
          </button>
        </div>
      </header>

      {rows === null && <p className="px-4 py-8 text-center text-[13px] text-fg-3">Loading…</p>}
      {loadError && <p className="px-4 py-8 text-center text-[13px] text-neg">{loadError}</p>}
      {rows && !loadError && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1060px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-sunk text-left text-[11px] tracking-[0.05em] text-fg-3 uppercase">
                <th rowSpan={2} className="px-3 py-2 font-semibold">Drive Description</th>
                <th rowSpan={2} className="px-2 py-2 font-semibold">Frame</th>
                <th colSpan={2} className="border-l border-line px-2 py-1.5 text-center font-semibold">Nominal Use</th>
                <th colSpan={2} className="border-l border-line px-2 py-1.5 text-center font-semibold">Light Duty</th>
                <th colSpan={2} className="border-l border-line px-2 py-1.5 text-center font-semibold">Heavy Duty</th>
                <th rowSpan={2} className="border-l border-line px-2 py-2 text-right font-semibold">List Price</th>
                <th rowSpan={2} className="px-2 py-2 text-right font-semibold">Disc.</th>
                <th rowSpan={2} className="px-2 py-2 text-right font-semibold">BOP Extra</th>
                <th rowSpan={2} className="px-2 py-2 text-right font-semibold">Net Price</th>
                <th rowSpan={2} className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
              <tr className="border-b border-line bg-sunk text-[11px] text-fg-3">
                {["P_N kW", "I_N A", "P_LD kW", "I_LD A", "P_HD kW", "I_HD A"].map((h, i) => (
                  <th key={h} className={`px-2 py-1 text-right font-medium ${i % 2 === 0 ? "border-l border-line" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-sunk/60">
                  <td className="px-3 py-2 font-mono text-fg" title={r.remarks ?? undefined}>
                    {r.driveDescription}
                    {r.remarks && <span className="ml-1 text-warn">*</span>}
                  </td>
                  <td className="px-2 py-2 text-fg-2">{r.frame ?? "—"}</td>
                  {[r.pnKw, r.inA, r.pldKw, r.ildA, r.phdKw, r.ihdA].map((v, i) => (
                    <td key={i} className={`px-2 py-2 text-right font-mono text-fg-2 ${i % 2 === 0 ? "border-l border-line" : ""}`}>
                      {show(v)}
                    </td>
                  ))}
                  <td className="border-l border-line px-2 py-2 text-right font-mono text-fg-2">
                    {formatInr(num(r.listPrice))}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-fg-3">
                    {r.discountPct === null ? "—" : `${Number(r.discountPct)}%`}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-fg-3">{formatInr(num(r.bopExtra))}</td>
                  <td className="px-2 py-2 text-right font-mono font-semibold text-fg">
                    {formatInr(vfdNetPrice(num(r.listPrice), num(r.discountPct), num(r.bopExtra)))}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <button type="button" className={btnSm} onClick={() => setEditing(r)}>
                        <EditIcon /> Edit
                      </button>
                      <button
                        type="button"
                        className={`${btnSm} hover:border-neg hover:text-neg`}
                        onClick={() => setDeleting(r)}
                        aria-label={`Delete ${r.driveDescription}`}
                        title="Delete"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-4 py-8 text-center text-[13px] text-fg-3">
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
    </section>
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
        <div className="grid grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          <FieldGrid fields={VFD_FIELDS} form={form} onChange={(k, v) => setForm((p) => ({ ...p, [k]: v }))} />
          <p className="text-[12.5px] text-fg-2 sm:col-span-2">
            Net price: <span className="font-mono font-semibold">{formatInr(net)}</span>
          </p>
          {formError && <p className="text-[12.5px] text-neg sm:col-span-2">{formError}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={saving}>
            {saving ? "Saving…" : row ? "Save changes" : "Add VFD"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
