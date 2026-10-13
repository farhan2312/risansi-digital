// Shared instant loading skeleton for /risansi pages. Re-exported as the
// `loading.tsx` of each route so every sidebar destination mounts its own
// Suspense boundary — otherwise navigating between siblings under the shared
// layout reuses one boundary and React keeps the old page (no loading state).
export default function PageLoading() {
  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8" aria-busy="true" aria-live="polite">
      {/* header: icon + title */}
      <div className="mb-6 flex items-center gap-3">
        <div className="h-11 w-11 animate-pulse rounded-xl bg-card-border" />
        <div className="space-y-2">
          <div className="h-6 w-48 animate-pulse rounded bg-card-border" />
          <div className="h-3.5 w-64 animate-pulse rounded bg-card-border/70" />
        </div>
      </div>

      {/* content card with shimmer rows */}
      <div className="rounded-xl border border-card-border bg-surface p-4 shadow-sm">
        <div className="mb-4 h-9 w-full max-w-xs animate-pulse rounded-lg bg-card-border/60" />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-4 w-10 animate-pulse rounded bg-card-border/70" />
              <div className="h-4 flex-1 animate-pulse rounded bg-card-border/50" />
              <div className="h-4 w-24 animate-pulse rounded bg-card-border/50" />
              <div className="h-4 w-16 animate-pulse rounded bg-card-border/40" />
            </div>
          ))}
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
