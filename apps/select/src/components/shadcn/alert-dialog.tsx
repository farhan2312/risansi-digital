"use client";

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

// shadcn/ui AlertDialog, plus ConfirmDialog: the one-call confirm this portal uses.
const AlertDialog = AlertDialogPrimitive.Root;

function AlertDialogContent({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-[1000] bg-slate-950/45 backdrop-blur-[1px]" />
      <AlertDialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-[1001] grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card p-5 text-card-foreground shadow-[0_24px_64px_rgba(15,23,42,0.25)]",
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

const AlertDialogTitle = ({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) => (
  <AlertDialogPrimitive.Title className={cn("text-[15px] font-semibold text-foreground", className)} {...props} />
);
const AlertDialogDescription = ({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Description>) => (
  <AlertDialogPrimitive.Description className={cn("text-[13px] leading-relaxed text-muted-foreground [&_strong]:text-foreground", className)} {...props} />
);

/** Confirm or cancel. While `busy` it can't be closed and the confirm waits. */
function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: React.ReactNode;
  cancelLabel?: React.ReactNode;
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <div className="grid gap-1.5">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : <AlertDialogDescription className="sr-only">{title}</AlertDialogDescription>}
        </div>
        <div className="flex justify-end gap-2">
          <AlertDialogPrimitive.Cancel className={buttonVariants({ variant: "outline" })} disabled={busy}>
            {cancelLabel}
          </AlertDialogPrimitive.Cancel>
          <button
            type="button"
            className={buttonVariants({ variant: tone === "danger" ? "destructive" : "default" })}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, ConfirmDialog };
