"use client";

import { useState, type ReactNode } from "react";

import type { BoiFieldDef } from "../../lib/boi-master";
import { buttonVariants } from "@/components/shadcn/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/shadcn/dialog";
import { ConfirmDialog } from "@/components/shadcn/alert-dialog";
import { Label } from "@/components/shadcn/field";
import { cn } from "@/lib/utils";

// Shared pieces of the BOI Master tabs: button/input styles, the modal frame,
// the field grid for add/edit forms and the delete confirmation (shadcn look,
// user 2026-11-13).

export const inputCls =
  "h-8 w-full rounded-md border border-input bg-card px-2.5 text-[12.5px] text-foreground shadow-xs outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25";
export const btnSm = buttonVariants({ variant: "outline", size: "sm" });
export const btnPrimary = buttonVariants({ variant: "default" });
export const btnSecondary = buttonVariants({ variant: "outline" });

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

/** The form frame: a dialog with a title bar; the children are the body and footer.
 *  Escape, the X or a click outside closes it, as before. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" className="max-w-[720px]" onInteractOutside={() => onClose()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
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
        <div key={f.key} className={cn("grid gap-1.5", (f.key === "remarks" || f.key === "description") && "sm:col-span-2")}>
          <Label htmlFor={`boi-${f.key}`}>
            {f.label}
            {f.required && <span className="ml-0.5 text-destructive">*</span>}
          </Label>
          <input
            id={`boi-${f.key}`}
            className={cn(inputCls, isNumeric(f) && "text-right font-mono tabular-nums")}
            type={f.kind === "date" ? "date" : isNumeric(f) ? "number" : "text"}
            step={f.kind === "integer" ? 1 : f.kind === "number" ? "any" : undefined}
            min={isNumeric(f) ? 0 : undefined}
            maxLength={f.max}
            value={form[f.key]}
            onChange={(e) => onChange(f.key, e.target.value)}
          />
        </div>
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
    <ConfirmDialog
      open
      title={`Delete ${what}?`}
      description={
        <>
          Delete <span className="font-mono font-semibold text-foreground">{name}</span> from the BOI Master? It can&apos;t be undone.
          Prices already saved on the Commercial Summary keep their amount.
        </>
      }
      confirmLabel={busy ? "Deleting…" : "Delete"}
      tone="danger"
      busy={busy}
      onConfirm={remove}
      onClose={onClose}
    >
      {err && <p className="text-[12.5px] font-medium text-destructive">{err}</p>}
    </ConfirmDialog>
  );
}
