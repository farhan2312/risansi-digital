import Link from "next/link";
import { ArrowRight, BarChart3, ClipboardList, Gauge, PieChart, Sparkles, TrendingUp } from "lucide-react";

const PREVIEW = [
  { icon: Gauge, label: "Headline metrics" },
  { icon: PieChart, label: "Department split" },
  { icon: TrendingUp, label: "Trends over time" },
  { icon: BarChart3, label: "Dispatch performance" },
];

/** The central dashboard while it is being built: points to the Orders page. */
export function DashboardComingSoon() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center">
      <div className="relative w-full overflow-hidden rounded-3xl border border-card-border bg-surface px-6 py-12 text-center shadow-sm sm:px-12 sm:py-16">
        {/* Soft glow behind the badge. */}
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 -right-16 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl" />

        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Coming soon
          </span>

          <div className="mx-auto mt-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <BarChart3 className="h-8 w-8" />
          </div>

          <h1 className="mt-6 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            The dashboard is on its way
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted sm:text-base">
            We&apos;re building a richer view of every SO from order to dispatch. Until then, the
            Orders page has the full picture — summary cards, filters and every department&apos;s status.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {PREVIEW.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium text-muted"
              >
                <Icon className="h-3.5 w-3.5 text-primary" />
                {label}
              </span>
            ))}
          </div>

          <Link
            href="/risansi/orders"
            className="group mt-10 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 transition-all hover:-translate-y-px hover:shadow-lg"
          >
            <ClipboardList className="h-4 w-4" />
            Go to Orders
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
