/** The SO's dispatch status as a coloured pill: Fully dispatch green, LOT dispatch blue, Pending amber. */
export function DispatchStatusPill({ status }: { status: unknown }) {
  const s = String(status ?? "").trim();
  if (!s) return <span className="text-muted-foreground">—</span>;
  const k = s.toLowerCase();
  const tone =
    k === "fully dispatch"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
      : k === "lot dispatch"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
        : k === "pending"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
          : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{s}</span>;
}
