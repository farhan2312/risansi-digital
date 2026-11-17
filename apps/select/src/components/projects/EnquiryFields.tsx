"use client";

import type { ReactNode } from "react";
import { Wrench, Cog, FileText, X } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/shadcn/dialog";
import { buttonVariants } from "@/components/shadcn/button";

import ClientLookup from "./ClientLookup";
import { ORDER_SUBTYPES, ORDER_TYPES, defaultSubtype, type OrderSubtype, type OrderType } from "../../lib/roles";
import type { ClientLookupRow } from "../../services/clientsService";
import { ENQUIRY_CATEGORIES, PROJECT_REMARKS_REQUIRED, type EnquiryCategory } from "../../lib/enquiry-fields";

// Building blocks shared by Create and Edit Enquiry (shadcn/ui look, user 2026-11-13): the modal
// shell, sections, labelled fields, the Order Type toggle and the client block
// (lookup + name, code, industry, reps, market type, zone).

export const inputCls =
  "h-9 w-full rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground shadow-xs outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50";

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
  // Escape, the X and Cancel close it, unless a save is in flight.
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="lg" hideClose className="max-w-[760px]" aria-label={title}>
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary ring-1 ring-primary/15" aria-hidden>
            <FileText className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[16px]">{title}</DialogTitle>
            <DialogDescription className="mt-0.5">{subtitle}</DialogDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/40 px-5 py-5 sm:px-6">{children}</div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-5 py-3 sm:px-6">{footer}</div>
      </DialogContent>
    </Dialog>
  );
}

export function Section({ step, title, subtitle, children }: { step: number; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
      <div className="mb-4 flex items-center gap-2.5 border-b border-border pb-3">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{step}</span>
        <div>
          <h3 className="text-[13.5px] font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-[11.5px] text-muted-foreground">{subtitle}</p>}
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
      <span className="mb-1.5 text-[12px] font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{hint}</span>}
    </Tag>
  );
}

/** Pump / Spare, then which kind (PCP, MMP, ... / Spare, Retrofit spare).
 *  Switching the type picks that type's first kind. */
export function OrderTypePicker({
  value,
  subtype,
  onChange,
}: {
  value: OrderType;
  subtype: OrderSubtype;
  onChange: (type: OrderType, subtype: OrderSubtype) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <OrderTypeToggle value={value} onChange={(t) => t !== value && onChange(t, defaultSubtype(t))} />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={value === "spare" ? "Spare type" : "Pump type"}>
        {ORDER_SUBTYPES[value].map((o) => {
          const on = subtype === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(value, o.value)}
              className={`h-7 rounded-md border px-3 text-[12.5px] font-medium transition-colors ${
                on ? "border-primary/40 bg-primary/8 text-primary" : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OrderTypeToggle({ value, onChange }: { value: OrderType; onChange: (v: OrderType) => void }) {
  return (
    <div className="grid grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5 ring-1 ring-border ring-inset" role="group" aria-label="Order type">
      {ORDER_TYPES.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`flex h-8 items-center justify-center gap-2 rounded-[5px] text-[13px] font-medium transition-colors ${
              on ? "bg-card text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.1)]" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.value === "pump" ? <Cog className="size-4" aria-hidden /> : <Wrench className="size-4" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Regular / Project, then the remarks - required for a Project enquiry. */
export function EnquiryCategoryFields({
  category,
  remarks,
  showErrors,
  onCategory,
  onRemarks,
}: {
  category: EnquiryCategory;
  remarks: string;
  /** Marks a missing Project remark in red (after a save was tried). */
  showErrors?: boolean;
  onCategory: (c: EnquiryCategory) => void;
  onRemarks: (r: string) => void;
}) {
  const isProject = category === "project";
  const missing = isProject && !remarks.trim();
  return (
    <>
      <Field label="Enquiry category" required wide group>
        <div className="grid grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5 ring-1 ring-border ring-inset" role="group" aria-label="Enquiry category">
          {ENQUIRY_CATEGORIES.map((o) => {
            const on = category === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => onCategory(o.value)}
                className={`flex h-8 items-center justify-center rounded-[5px] text-[13px] font-medium transition-colors ${
                  on ? "bg-card text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.1)]" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </Field>
      <Field
        label="Remarks"
        required={isProject}
        wide
        hint={missing && showErrors ? <span className="text-destructive">{PROJECT_REMARKS_REQUIRED}</span> : isProject ? "Required for a Project enquiry." : undefined}
      >
        <textarea
          rows={2}
          maxLength={2000}
          value={remarks}
          aria-invalid={missing && showErrors ? true : undefined}
          onChange={(e) => onRemarks(e.target.value)}
          placeholder={isProject ? "About the project" : "Optional"}
          className={`${inputCls} h-auto min-h-[60px] py-2 ${missing && showErrors ? "border-destructive" : ""}`}
        />
      </Field>
    </>
  );
}

/** Off by default. On: the client's documents are made by hand and linked from
 *  SharePoint on Review, instead of the generated ones (lib/doc-links.ts). */
export function NonStandardFormatField({ value, isSpare, hint, onChange }: { value: boolean; isSpare: boolean; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-w-0 flex-col sm:col-span-2">
      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label="Non-standard format"
          onClick={() => onChange(!value)}
          className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 ${value ? "bg-primary" : "bg-input"}`}
        >
          <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.25)] transition-transform ${value ? "translate-x-4" : ""}`} />
        </button>
        <span className="min-w-0">
          <span className="block text-[12.5px] font-medium text-foreground">Non-standard format</span>
          <span className="block text-[11.5px] leading-snug text-muted-foreground">
            {value
              ? isSpare
                ? "The client asked for its own format: the quotation is made by hand and its SharePoint link is added on Review. Operation opens that file, not the generated one."
                : "The client asked for its own format: Technical, Commercial and Techno-Commercial are made by hand and their SharePoint links are added on Review. Operation opens those files, not the generated ones."
              : "Off: the portal generates the documents."}
          </span>
          {hint && <span className="mt-1 block text-[11.5px] leading-snug text-warning">{hint}</span>}
        </span>
      </div>
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

export const btnSecondary = buttonVariants({ variant: "outline", size: "lg" });
export const btnPrimary = buttonVariants({ variant: "default", size: "lg" });
