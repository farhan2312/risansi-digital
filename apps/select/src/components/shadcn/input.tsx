import * as React from "react";
import { cn } from "@/lib/utils";

// shadcn/ui Input; `icon` sits inside on the left.
function Input({ className, icon, type, ...props }: React.ComponentProps<"input"> & { icon?: React.ReactNode }) {
  const field = (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-[12.5px] text-foreground shadow-xs transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        icon ? "pl-8" : "",
        className,
      )}
      {...props}
    />
  );
  if (!icon) return field;
  return (
    <span className="relative block w-full">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground [&_svg]:size-3.5">{icon}</span>
      {field}
    </span>
  );
}

/** A native select styled as the Input (keyboard and mobile behave as before). */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-8 rounded-md border border-input bg-card px-2.5 text-[12.5px] font-medium text-foreground shadow-xs outline-none transition-[box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25",
        className,
      )}
      {...props}
    />
  );
}

export { Input, NativeSelect };
