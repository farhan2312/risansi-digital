import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// shadcn/ui Badge, with soft tones for statuses (tinted fill, a hairline ring).
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-md px-1.5 py-px text-[11px] font-medium whitespace-nowrap ring-1 ring-inset [&>svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground ring-border",
        primary: "bg-primary/8 text-primary ring-primary/20",
        info: "bg-info/10 text-info ring-info/25",
        success: "bg-success/10 text-success ring-success/25",
        warning: "bg-warning/10 text-warning ring-warning/25",
        danger: "bg-destructive/10 text-destructive ring-destructive/25",
        outline: "bg-transparent text-foreground ring-border",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

function Badge({ className, tone, dot, children, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
