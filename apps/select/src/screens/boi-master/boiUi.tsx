"use client";

import { useEffect, useState, type ReactNode } from "react";

import type { BoiFieldDef } from "../../lib/boi-master";

// Shared pieces of the BOI Master tabs: button/input styles, the modal frame,
// the field grid for add/edit forms and the delete confirmation.

export const inputCls =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-fg outline-none transition placeholder:text-fg-4 focus:border-accent focus:ring-2 focus:ring-accent-soft";
export const btnSm =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap text-fg-2 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5";
export const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4";
export const btnSecondary =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3.5 py-2 text-[13px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:opacity-50";

export const errorMessage = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;

const isNumeric = (f: BoiFieldDef) => f.kind === "number" || f.kind === "integer";

/** A stored row as form text ("" for blanks; numbers without trailing zeros). */
export const formFromRow = (fields: BoiFieldDef[], row: object | null | undefined) =>
  Object.fromEntries(
    fields.map((f) => {
      const v = (row as Record<string, unknown> | null | undefined)?.[f.key];
      return [f.key, v === null || v === undefined ? "" : isNumeric(f) ? String(Number(v)) : String(v)];
    }),
  ) as Record<string, string>;

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-line bg-paper"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-fg-3 hover:text-fg" aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Inputs for a field list (two columns; description/remarks span both). */
export function FieldGrid({
  fields,
  form,
  onChange,
}: {
  fields: BoiFieldDef[];
  form: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <>
      {fields.map((f) => (
        <label
          key={f.key}
          className={`flex flex-col gap-1 ${f.key === "remarks" || f.key === "description" ? "sm:col-span-2" : ""}`}
        >
          <span className="text-[11.5px] font-semibold text-fg-3">
            {f.label}
            {f.required ? " *" : ""}
          </span>
          <input
            className={`${inputCls} ${isNumeric(f) ? "text-right font-mono" : ""}`}
            type={f.kind === "date" ? "date" : isNumeric(f) ? "number" : "text"}
            step={f.kind === "integer" ? 1 : f.kind === "number" ? "any" : undefined}
            min={isNumeric(f) ? 0 : undefined}
            maxLength={f.max}
            value={form[f.key]}
            onChange={(e) => onChange(f.key, e.target.value)}
          />
        </label>
      ))}
    </>
  );
}

/** "Delete X?" — runs onConfirm, shows its error if it fails. */
export function DeleteConfirm({
  what,
  name,
  onConfirm,
  onClose,
}: {
  what: string;
  name: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await onConfirm();
    } catch (e) {
      setErr(errorMessage(e, `Couldn't delete this ${what}.`));
      setBusy(false);
    }
  };
  return (
    <Modal title={`Delete ${what}?`} onClose={onClose}>
      <div className="flex flex-col gap-2 p-4 text-[13px] text-fg-2">
        <p>
          Delete <span className="font-mono font-semibold text-fg">{name}</span> from the BOI Master? It can&apos;t be
          undone. Prices already saved on the Commercial Summary keep their amount.
        </p>
        {err && <p className="text-neg">{err}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
        <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-neg px-3.5 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
          onClick={remove}
          disabled={busy}
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
      </footer>
    </Modal>
  );
}
