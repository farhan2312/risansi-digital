"use client";

/** Colours for the statuses: Pending / In Progress / Completed / Not Quoted / Sent to client. */
export const LIFECYCLE_STYLE: Record<string, { pill: string; dot: string; color: string }> = {
  pending: { pill: "bg-[var(--warn-soft)] text-warn", dot: "bg-warn", color: "var(--warn)" },
  "in progress": { pill: "bg-accent-soft text-accent", dot: "bg-[var(--brand-blue)]", color: "var(--brand-blue)" },
  completed: { pill: "bg-[var(--pos-soft)] text-pos", dot: "bg-pos", color: "var(--pos)" },
  "not quoted": { pill: "bg-sunk text-fg-2", dot: "bg-fg-4", color: "var(--fg-4)" },
  "sent to client": {
    pill: "bg-[color-mix(in_srgb,var(--brand-cyan)_15%,transparent)] text-[color-mix(in_srgb,var(--brand-cyan)_65%,var(--fg))]",
    dot: "bg-[var(--brand-cyan)]",
    color: "var(--brand-cyan)",
  },
};

export const lifecycleStyle = (status: string | null | undefined) =>
  LIFECYCLE_STYLE[(status ?? "").trim().toLowerCase()] ?? {
    pill: "bg-sunk text-fg-2",
    dot: "bg-fg-4",
    color: "var(--fg-4)",
  };

/** Rounded status chip with a coloured dot. */
export default function StatusPill({ status }: { status: string | null | undefined }) {
  const s = lifecycleStyle(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status || "—"}
    </span>
  );
}
