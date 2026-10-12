/**
 * Human-readable durations. No DB imports, so it is safe in client components
 * — the Audit Log page and its (client-side) PDF report both use it.
 */

/** "3h 25m", "12m", "45s", or "—" when there is nothing to show. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (s === 0) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
