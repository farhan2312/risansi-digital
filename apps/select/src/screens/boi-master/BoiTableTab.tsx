"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { EditIcon, PlusIcon, TrashIcon } from "../../components/ui/adminIcons";
import { BOI_TABLES, type BoiTableDef, type BoiTableTab as TabKey } from "../../lib/boi-tables";
import { formatInr } from "../../lib/commercial";
import {
  createBoiTableRow,
  deleteBoiTableRow,
  listBoiTable,
  updateBoiTableRow,
  type BoiTableRow,
} from "../../services/boiMasterService";
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

// A BOI Master tab made of simple editable tables (lib/boi-tables.ts):
//   DRP        RTD probe + RTD panel prices ("Drp Probe Price List 12-07-25.xlsx")
//   Shaft Dia  one row per pump model; DRP picks the smallest probe ≥ it.

type TableDef = BoiTableDef;

/** Tables with more rows than this get a search box. */
const SEARCH_FROM = 12;

export default function BoiTableTab({ tab, intro }: { tab: TabKey; intro: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg border border-line bg-sunk px-4 py-2.5 text-[12.5px] text-fg-2">{intro}</p>
      {BOI_TABLES.filter((t) => t.tab === tab).map((t) => (
        <TableSection key={t.key} def={t} />
      ))}
    </div>
  );
}

const cellText = (def: TableDef, key: string, v: string | number | null) => {
  if (v === null || v === "") return "—";
  const field = def.fields.find((f) => f.key === key);
  if (key === "ratePerNos" || /^price\d/.test(key)) return formatInr(Number(v));
  if (field?.kind === "number") return String(Number(v));
  return String(v);
};

function TableSection({ def }: { def: TableDef }) {
  const [rows, setRows] = useState<BoiTableRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<BoiTableRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<BoiTableRow | null>(null);
  const [search, setSearch] = useState("");
  const table = def.key;

  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return (rows ?? []).filter((r) => {
      const hay = def.fields.map((f) => String(r[f.key] ?? "")).join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, search, def.fields]);

  const reload = () =>
    listBoiTable(table)
      .then(setRows)
      .catch(() => {
        setLoadError(`Couldn't load the ${def.title} table.`);
        setRows([]);
      });

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  return (
    <section className="rounded-xl border border-line bg-paper">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-fg">{def.title}</h2>
          <p className="text-[12px] text-fg-3">{def.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {(rows?.length ?? 0) > SEARCH_FROM && (
            <input
              type="search"
              className={`${inputCls} w-[200px]`}
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={`Search ${def.title}`}
            />
          )}
          <button type="button" className={btnPrimary} onClick={() => setEditing("new")}>
            <PlusIcon /> Add row
          </button>
        </div>
      </header>

      {rows === null && <p className="px-4 py-6 text-center text-[13px] text-fg-3">Loading…</p>}
      {loadError && <p className="px-4 py-6 text-center text-[13px] text-neg">{loadError}</p>}
      {rows && !loadError && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-sunk text-left text-[11px] tracking-[0.05em] text-fg-3 uppercase">
                {def.fields.map((f) => (
                  <th
                    key={f.key}
                    className={`px-3 py-2 font-semibold ${f.kind === "number" || f.kind === "integer" ? "text-right" : ""}`}
                  >
                    {f.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-sunk/60">
                  {def.fields.map((f) => (
                    <td
                      key={f.key}
                      className={`px-3 py-2 text-fg-2 ${
                        f.kind === "number" || f.kind === "integer" ? "text-right font-mono" : ""
                      }`}
                    >
                      {cellText(def, f.key, r[f.key])}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <button type="button" className={btnSm} onClick={() => setEditing(r)}>
                        <EditIcon /> Edit
                      </button>
                      <button
                        type="button"
                        className={`${btnSm} hover:border-neg hover:text-neg`}
                        onClick={() => setDeleting(r)}
                        aria-label="Delete row"
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
                  <td colSpan={def.fields.length + 1} className="px-4 py-6 text-center text-[13px] text-fg-3">
                    {rows.length === 0 ? "No rows yet — add the first one." : "No row matches that search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TableFormModal
          def={def}
          row={editing === "new" ? null : editing}
          // A new probe / panel row starts with the list's description and W.E.F.
          defaults={rows?.[0]}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          what="row"
          name={def.label(deleting)}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteBoiTableRow(table, deleting.id);
            setRows((prev) => (prev ?? []).filter((r) => r.id !== deleting.id));
            setDeleting(null);
          }}
        />
      )}
    </section>
  );
}

function TableFormModal({
  def,
  row,
  defaults,
  onClose,
  onSaved,
}: {
  def: TableDef;
  row: BoiTableRow | null;
  defaults: BoiTableRow | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(() =>
    formFromRow(
      def.fields,
      row ?? (def.key === "shaft-dia" ? null : { description: defaults?.description, wefDate: defaults?.wefDate }),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const table = def.key;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const missing = def.fields.find((f) => f.required && !form[f.key].trim());
    if (missing) {
      setFormError(`${missing.label} is required.`);
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (row) await updateBoiTableRow(table, row.id, form);
      else await createBoiTableRow(table, form);
      onSaved();
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't save this row."));
      setSaving(false);
    }
  };

  return (
    <Modal title={`${row ? "Edit" : "Add"} ${def.title} row`} onClose={onClose}>
      <form onSubmit={submit} className="flex min-h-0 flex-col">
        <div className="grid grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          <FieldGrid fields={def.fields} form={form} onChange={(k, v) => setForm((p) => ({ ...p, [k]: v }))} />
          {formError && <p className="text-[12.5px] text-neg sm:col-span-2">{formError}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={saving}>
            {saving ? "Saving…" : row ? "Save changes" : "Add row"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
