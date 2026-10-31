"use client";

import { useEffect, type ReactNode } from "react";

import ClientLookup from "./ClientLookup";
import { ORDER_TYPES, type OrderType } from "../../lib/roles";
import type { ClientLookupRow } from "../../services/clientsService";

// Building blocks shared by Create and Edit Enquiry (Tailwind): the modal
// shell, sections, labelled fields, the Order Type toggle and the client block
// (lookup + name, code, industry, reps, market type, zone).

export const inputCls =
  "h-10 w-full rounded-lg border border-line-strong bg-paper px-3 text-[14px] text-fg outline-none transition placeholder:text-fg-4 hover:border-fg-3 focus:border-accent focus:ring-4 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60";

export function ModalShell({
  title,
  subtitle,
  busy,
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  busy?: boolean;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  // Escape closes, unless a save is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[rgba(10,22,40,0.55)] p-3 backdrop-blur-[3px] sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-full w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-[0_24px_64px_rgba(10,22,40,0.28)]"
      >
        <div className="relative flex items-start gap-3.5 border-b border-line px-5 py-4 sm:px-6">
          <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[var(--brand-blue)] to-[var(--brand-cyan)]" aria-hidden />
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5M9 13h6M9 17h4" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-title">{title}</h2>
            <p className="mt-0.5 text-[12.5px] text-fg-3">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-3 transition hover:bg-elev hover:text-fg disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto bg-sunk/40 px-5 py-5 sm:px-6">{children}</div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-line bg-paper px-5 py-3.5 sm:px-6">{footer}</div>
      </div>
    </div>
  );
}

export function Section({ step, title, subtitle, children }: { step: number; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-paper p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11.5px] font-bold text-white">{step}</span>
        <div>
          <h3 className="text-[13.5px] font-semibold text-fg">{title}</h3>
          {subtitle && <p className="text-[11.5px] text-fg-3">{subtitle}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function Field({
  label,
  required,
  hint,
  wide,
  group,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  /** Spans both columns. */
  wide?: boolean;
  /** A group of buttons, not one input: a <label> would forward clicks on
   *  its text to the first button. */
  group?: boolean;
  children: ReactNode;
}) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className={`flex min-w-0 flex-col ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 text-[12px] font-semibold text-fg-2">
        {label}
        {required && <span className="ml-0.5 text-neg">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 text-[11.5px] leading-snug text-fg-3">{hint}</span>}
    </Tag>
  );
}

export function OrderTypePicker({ value, onChange }: { value: OrderType; onChange: (v: OrderType) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-sunk p-1" role="group" aria-label="Order type">
      {ORDER_TYPES.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`flex h-9 items-center justify-center gap-2 rounded-lg text-[13.5px] font-semibold transition ${
              on ? "bg-paper text-accent shadow-[0_1px_3px_rgba(10,22,40,0.12)] ring-1 ring-line" : "text-fg-3 hover:text-fg"
            }`}
          >
            {o.value === "pump" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4" aria-hidden>
                <circle cx="12" cy="12" r="7" />
                <circle cx="12" cy="12" r="2.5" />
                <path d="M12 5V2M19 12h3" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
              </svg>
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export type ClientDetails = {
  clientPrimaryRep: string;
  clientSecondaryReps: string;
  clientMarketType: string;
  clientZone: string;
};

/** The client block's fields (name is projects.name, the Client Name). */
export type ClientForm = { name: string; clientCode: string; industry: string } & ClientDetails;

export const EMPTY_CLIENT: ClientForm = {
  name: "",
  clientCode: "",
  industry: "",
  clientPrimaryRep: "",
  clientSecondaryReps: "",
  clientMarketType: "",
  clientZone: "",
};

/** A picked client fills every field (all still editable). */
export const clientFormOf = (row: ClientLookupRow): ClientForm => ({
  name: row.legal_name,
  clientCode: row.code,
  industry: row.industry ?? "",
  clientPrimaryRep: row.primary_rep ?? "",
  clientSecondaryReps: row.secondary_reps ?? "",
  clientMarketType: row.market_type ?? "",
  clientZone: row.zone ?? "",
});

/** Find client + the client fields, in two columns. */
export function ClientFields({
  value,
  onChange,
  active = true,
  lookupKey,
  lookupHint,
}: {
  value: ClientForm;
  onChange: (next: ClientForm) => void;
  active?: boolean;
  /** Remounts the lookup (fresh search) for a different enquiry. */
  lookupKey?: string;
  lookupHint?: string;
}) {
  const set = (k: keyof ClientForm) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <div className="sm:col-span-2">
        <ClientLookup key={lookupKey} active={active} hint={lookupHint} onSelect={(row) => onChange(clientFormOf(row))} />
      </div>
      <Field label="Client name" wide>
        <input className={inputCls} value={value.name} onChange={set("name")} placeholder="Client name" />
      </Field>
      <Field label="Client code">
        <input className={`${inputCls} font-mono`} value={value.clientCode} onChange={set("clientCode")} placeholder="e.g. NUND01A094" />
      </Field>
      <Field label="Industry">
        <input className={inputCls} value={value.industry} onChange={set("industry")} placeholder="Industry" />
      </Field>
      <Field label="Primary rep">
        <input className={inputCls} value={value.clientPrimaryRep} onChange={set("clientPrimaryRep")} placeholder="Primary rep" />
      </Field>
      <Field label="Secondary reps">
        <input className={inputCls} value={value.clientSecondaryReps} onChange={set("clientSecondaryReps")} placeholder="Secondary reps" />
      </Field>
      <Field label="Market type">
        <input className={inputCls} value={value.clientMarketType} onChange={set("clientMarketType")} placeholder="Domestic / Export" />
      </Field>
      <Field label="Zone">
        <input className={inputCls} value={value.clientZone} onChange={set("clientZone")} placeholder="Zone" />
      </Field>
    </>
  );
}

export const btnSecondary =
  "inline-flex h-10 items-center rounded-lg border border-line-strong bg-paper px-4 text-[13.5px] font-semibold text-fg-2 transition hover:border-fg-3 hover:bg-elev disabled:cursor-not-allowed disabled:opacity-60";
export const btnPrimary =
  "inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-5 text-[13.5px] font-semibold text-white shadow-[0_1px_2px_rgba(10,61,143,0.2)] transition hover:-translate-y-px hover:shadow-[0_6px_16px_color-mix(in_srgb,var(--brand-blue)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0";
