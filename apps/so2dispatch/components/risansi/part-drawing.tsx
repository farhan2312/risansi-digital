"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus, Search, X } from "lucide-react";
import {
  OTHER_PART_SECTION,
  partDrawingStatus,
  partListsFor,
  type PartDrawingTone,
  type PartListItem,
} from "@/lib/part-drawings";
import { savePartProgressAction, savePartSelectionAction, saveShortageAction } from "@/app/risansi/orders/part-drawing-actions";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const keyOf = (p: { section?: unknown; part_no?: unknown; part_name?: unknown }) =>
  [p.section, p.part_no, p.part_name].map((v) => str(v).trim().toLowerCase()).join("|");

const TONE: Record<PartDrawingTone, string> = {
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  part: "bg-sky-50 text-sky-700 ring-sky-200",
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
};

/** An EC's part drawings on the front: status and parts drawn of parts picked. */
export function PartDrawingCell({ required, parts }: { required: unknown; parts: Row[] }) {
  const st = partDrawingStatus(required, parts);
  if (!st) {
    return <span className="text-xs text-muted">{str(required).toLowerCase() === "no" ? "No" : "Not asked"}</span>;
  }
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONE[st.tone]}`}>
        {st.tone === "done" && <CheckCircle2 className="h-3 w-3" />}
        {st.label}
      </span>
      <span className="text-[11px] text-muted">
        {st.done}/{st.total} part{st.total === 1 ? "" : "s"}
      </span>
    </span>
  );
}

function Shell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const input =
  "h-10 w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:bg-background disabled:text-muted";

/**
 * Planning's pick for one EC: part drawing Yes / No, and the parts — ticked
 * from the pump's parts list, or named under Others.
 */
export function PartPickerModal({
  itemId,
  label,
  pumpType,
  required,
  parts,
  canEdit,
  onClose,
  mode = "drawing",
}: {
  /** Part drawings (Yes / No and the parts), or the parts the EC is short of. */
  mode?: "drawing" | "shortage";
  itemId: string;
  label: string;
  pumpType: unknown;
  required?: unknown;
  parts: Row[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const lists = partListsFor(pumpType);
  const shortage = mode === "shortage";
  // A shortage is just its parts: there is no Yes / No to it.
  const [yes, setYes] = useState(shortage || str(required).toLowerCase() === "yes");
  // Picked parts by key; the list's parts and any others already named.
  const [picked, setPicked] = useState<Map<string, PartListItem>>(
    () =>
      new Map(
        parts.map((p) => {
          const item = { section: str(p.section) || OTHER_PART_SECTION, part_no: str(p.part_no), part_name: str(p.part_name) };
          return [keyOf(item), item];
        })
      )
  );
  const [find, setFind] = useState("");
  const [other, setOther] = useState({ part_no: "", part_name: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ro = !canEdit;

  const toggle = (p: PartListItem) =>
    setPicked((m) => {
      const next = new Map(m);
      const k = keyOf(p);
      if (next.has(k)) next.delete(k);
      else next.set(k, p);
      return next;
    });
  const listKeys = new Set(lists.flatMap((l) => l.parts.map(keyOf)));
  const others = [...picked.values()].filter((p) => !listKeys.has(keyOf(p)));
  const q = find.trim().toLowerCase();
  const matches = (p: PartListItem) => !q || p.part_name.toLowerCase().includes(q) || p.part_no.includes(q);

  function addOther() {
    const name = other.part_name.trim();
    if (!name) return;
    const item = { section: OTHER_PART_SECTION, part_no: other.part_no.trim(), part_name: name };
    setPicked((m) => new Map(m).set(keyOf(item), item));
    setOther({ part_no: "", part_name: "" });
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = shortage
      ? await saveShortageAction(itemId, [...picked.values()])
      : await savePartSelectionAction(itemId, yes ? "Yes" : "No", yes ? [...picked.values()] : []);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <Shell title={`${shortage ? "Shortage" : "Part drawing"} · ${label}`} subtitle={lists.map((l) => l.title).join(" / ")} onClose={onClose}>
      {shortage ? (
        <p className="mb-4 text-sm text-muted">
          Tick the parts this EC is short of. <span className="font-medium text-foreground">{picked.size} short</span>
        </p>
      ) : (
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-foreground">Part drawing required</span>
        <div role="radiogroup" className="inline-flex h-10 rounded-lg border border-input-border p-0.5">
          {(["No", "Yes"] as const).map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={(o === "Yes") === yes}
              disabled={ro}
              onClick={() => setYes(o === "Yes")}
              className={`rounded-md px-4 text-sm font-semibold transition-colors ${
                (o === "Yes") === yes ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
        {yes && <span className="text-sm text-muted">{picked.size} picked</span>}
      </div>
      )}

      {yes && (
        <div className="space-y-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a part by name or number…" className={`${input} pl-9`} />
          </label>
          {lists.map((l) => {
            const sections = [...new Set(l.parts.map((p) => p.section))];
            return (
              <section key={l.title} className="rounded-xl border border-card-border p-4">
                {lists.length > 1 && <h3 className="mb-2 text-sm font-semibold text-foreground">{l.title}</h3>}
                {sections.map((sec) => {
                  const shown = l.parts.filter((p) => p.section === sec && matches(p));
                  if (shown.length === 0) return null;
                  return (
                    <div key={sec} className="mb-3 last:mb-0">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{sec}</p>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {shown.map((p) => {
                          const on = picked.has(keyOf(p));
                          return (
                            <label
                              key={keyOf(p)}
                              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                                on ? "border-primary/50 bg-primary/5" : "border-transparent hover:bg-background"
                              }`}
                            >
                              <input type="checkbox" checked={on} disabled={ro} onChange={() => toggle(p)} className="h-4 w-4 accent-primary" />
                              <span className="w-12 shrink-0 text-xs tabular-nums text-muted">{p.part_no}</span>
                              <span className="text-foreground">{p.part_name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}

          <section className="rounded-xl border border-card-border p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Others</h3>
            {others.length > 0 && (
              <ul className="mb-3 flex flex-wrap gap-2">
                {others.map((p) => (
                  <li key={keyOf(p)} className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-sm">
                    {p.part_no && <span className="text-xs text-muted">{p.part_no}</span>}
                    {p.part_name}
                    {!ro && (
                      <button type="button" onClick={() => toggle(p)} aria-label={`Remove ${p.part_name}`} className="text-muted hover:text-rose-600">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!ro && (
              <div className="flex flex-wrap gap-2">
                <input value={other.part_no} onChange={(e) => setOther((o) => ({ ...o, part_no: e.target.value }))} placeholder="Part No." className={`${input} w-28`} />
                <input
                  value={other.part_name}
                  onChange={(e) => setOther((o) => ({ ...o, part_name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addOther();
                    }
                  }}
                  placeholder="Part name"
                  className={`${input} min-w-[12rem] flex-1`}
                />
                <button
                  type="button"
                  onClick={addOther}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-dashed border-primary/50 px-3 text-sm font-semibold text-primary hover:bg-primary/10"
                >
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {canEdit && (
        <div className="mt-4 flex items-center justify-end gap-3">
          {error && <span className="text-sm text-rose-600">{error}</span>}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      )}
    </Shell>
  );
}

/** Drawing's side: each part Planning picked, ticked complete with its date. */
export function PartProgress({ itemId, parts, canEdit }: { itemId: string; parts: Row[]; canEdit: boolean }) {
  const router = useRouter();
  const initial = () =>
    parts.map((p) => ({
      id: str(p.id),
      completed: str(p.completed).toLowerCase() === "yes" ? "Yes" : "",
      completed_date: str(p.completed_date).slice(0, 10),
      remarks: str(p.remarks),
    }));
  const [rows, setRows] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial());
  const ro = !canEdit;
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setSaved(false);
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const live = partDrawingStatus("Yes", rows);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await savePartProgressAction(itemId, rows);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  if (parts.length === 0) {
    return <p className="rounded-xl border border-dashed border-card-border px-4 py-8 text-center text-sm text-muted">Planning has not picked any parts yet.</p>;
  }
  return (
    <div className="space-y-3">
      {live && (
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE[live.tone]}`}>{live.label}</span>
          <span className="text-xs text-muted">
            {live.done}/{live.total} parts drawn
          </span>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-card-border">
        <table className="w-full text-sm">
          <thead className="bg-background/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Part No.</th>
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2">Complete</th>
              <th className="px-3 py-2">Completed Date</th>
              <th className="px-3 py-2">Remarks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {parts.map((p, i) => {
              const r = rows[i];
              const done = r.completed === "Yes";
              return (
                <tr key={r.id} className={done ? "bg-emerald-50/40" : ""}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">{str(p.part_no) || "—"}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-foreground">{str(p.part_name)}</span>
                    <span className="block text-[11px] text-muted">{str(p.section)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={done}
                      disabled={ro}
                      onChange={(e) =>
                        set(i, e.target.checked ? { completed: "Yes", completed_date: r.completed_date || today() } : { completed: "", completed_date: "" })
                      }
                      aria-label={`${str(p.part_name)} complete`}
                      className="h-4 w-4 accent-primary"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input type="date" value={r.completed_date} disabled={ro || !done} onChange={(e) => set(i, { completed_date: e.target.value })} className={`${input} h-9 w-40`} />
                  </td>
                  <td className="px-3 py-2">
                    <input value={r.remarks} disabled={ro} onChange={(e) => set(i, { remarks: e.target.value })} className={`${input} h-9 min-w-[12rem]`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {error && <span className="text-sm text-rose-600">{error}</span>}
          {saved && !dirty && <span className="text-sm text-emerald-700">Saved</span>}
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      )}
    </div>
  );
}

/** The parts an EC is short of, on the front: none, or how many and which. */
export function ShortageCell({ parts }: { parts: Row[] }) {
  if (parts.length === 0) return <span className="text-xs text-muted">None</span>;
  const names = parts.map((p) => str(p.part_name));
  return (
    <span title={names.join(", ")} className="flex flex-col items-start gap-0.5">
      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
        {parts.length} short
      </span>
      <span className="max-w-[12rem] truncate text-[11px] text-muted">
        {names.slice(0, 2).join(", ")}
        {names.length > 2 ? ` +${names.length - 2}` : ""}
      </span>
    </span>
  );
}
