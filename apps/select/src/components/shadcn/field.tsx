import * as React from "react";
import { cn } from "@/lib/utils";

// shadcn/ui Label and Textarea, plus Field: a label over a control with an optional hint
// or error under it, the way the forms in this portal are laid out.
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cn("text-[12px] font-medium text-foreground select-none", className)} {...props} />;
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-[72px] w-full rounded-md border border-input bg-card px-2.5 py-2 text-[12.5px] text-foreground shadow-xs outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
      )}
      {children}
      {error ? <p className="text-[11.5px] font-medium text-destructive">{error}</p> : hint ? <p className="text-[11.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A form-level error or notice. */
function Alert({ tone = "danger", className, ...props }: React.ComponentProps<"div"> & { tone?: "danger" | "success" | "warning" | "info" }) {
  const tones = {
    danger: "border-destructive/25 bg-destructive/8 text-destructive",
    success: "border-success/25 bg-success/8 text-success",
    warning: "border-warning/25 bg-warning/10 text-warning",
    info: "border-info/25 bg-info/8 text-info",
  };
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-[12.5px] font-medium", tones[tone], className)} {...props} />;
}

export { Label, Textarea, Field, Alert };
