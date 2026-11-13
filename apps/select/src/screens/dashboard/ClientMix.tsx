"use client";

import type { ReactNode } from "react";
import { Globe, Grid3x3, MapPin, Users } from "lucide-react";
import { DonutChart, fmtNum, heatColor } from "../../components/charts/charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/shadcn/card";
import type { DashboardData } from "../../services/dashboardService";

// Dashboard "Client mix": who the enquiries in scope are for - order type,
// market type and zone as donuts, primary reps with their enquiries' status,
// and a rep x zone heatmap. Follows the Dashboard's filters, period and scope.

// Status colours: the validated chart tokens (src/index.css --chart-*), as the badges mean them.
const STATUS = [
  { key: "pending", label: "Pending", color: "var(--chart-pending)" },
  { key: "inProgress", label: "In progress", color: "var(--chart-progress)" },
  { key: "completed", label: "Completed", color: "var(--chart-done)" },
  { key: "sentToClient", label: "Sent to client", color: "var(--chart-sent)" },
  { key: "notQuoted", label: "Not quoted", color: "var(--chart-none)" },
  { key: "regret", label: "Regret", color: "var(--chart-regret)" },
] as const;

const NOT_SET = "Not set";

/** A dashboard section: a Card with its title, subtitle and icon in the header. */
function Section({ icon, title, subtitle, className, children }: { icon: ReactNode; title: string; subtitle?: string; className?: string; children: ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5">{icon}</span>
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            {subtitle && <CardDescription className="truncate">{subtitle}</CardDescription>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="py-4">{children}</CardContent>
    </Card>
  );
}

function Empty() {
  return <p className="py-8 text-center text-[12.5px] text-muted-foreground">Nothing in this period</p>;
}

function RepBars({ reps }: { reps: DashboardData["mix"]["reps"] }) {
  if (reps.length === 0) return <Empty />;
  const max = Math.max(1, ...reps.map((r) => r.total));
  return (
    <div>
      <ul className="space-y-3">
        {reps.map((r) => (
          <li key={r.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className={`min-w-0 truncate ${r.label === NOT_SET ? "text-muted-foreground italic" : "font-medium text-foreground"}`}>{r.label}</span>
              <span className="shrink-0 font-mono font-semibold text-foreground tabular-nums">{fmtNum(r.total)}</span>
            </div>
            {/* Bar length = share of the busiest rep; segments = status, 2px surface gap between them. */}
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="flex h-full gap-[2px] transition-[width] duration-500" style={{ width: `${(r.total / max) * 100}%` }}>
                {STATUS.map((s) =>
                  r[s.key] > 0 ? (
                    <span key={s.key} title={`${s.label}: ${r[s.key]}`} style={{ width: `${(r[s.key] / r.total) * 100}%`, background: s.color }} className="h-full first:rounded-l-full last:rounded-r-[4px]" />
                  ) : null,
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
        {STATUS.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function RepZoneHeatmap({ mix }: { mix: DashboardData["mix"] }) {
  const reps = mix.reps.map((r) => r.label);
  const zones = mix.zones.map((z) => z.label);
  if (reps.length === 0 || zones.length === 0) return <Empty />;
  const at = new Map(mix.repZone.map((c) => [`${c.rep}|${c.zone}`, c.count]));
  const max = Math.max(1, ...mix.repZone.map((c) => c.count));
  const zoneTotal = (z: string) => reps.reduce((t, r) => t + (at.get(`${r}|${z}`) ?? 0), 0);
  const head = "text-[11px] font-medium tracking-wide text-muted-foreground uppercase";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[3px] text-[12px]">
        <thead>
          <tr>
            <th className={`w-[1%] pr-2 text-left whitespace-nowrap ${head}`}>Rep \ Zone</th>
            {zones.map((z) => (
              <th key={z} className={`min-w-[64px] px-1 text-center text-[11px] font-medium ${z === NOT_SET ? "text-muted-foreground italic" : "text-foreground"}`}>
                {z}
              </th>
            ))}
            <th className={`min-w-[48px] text-center ${head}`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {mix.reps.map((r) => (
            <tr key={r.label}>
              <td className={`max-w-[170px] truncate pr-2 whitespace-nowrap ${r.label === NOT_SET ? "text-muted-foreground italic" : "font-medium text-foreground"}`} title={r.label}>
                {r.label}
              </td>
              {zones.map((z) => {
                const n = at.get(`${r.label}|${z}`) ?? 0;
                const ratio = n / max;
                return (
                  <td
                    key={z}
                    title={`${r.label} · ${z}: ${n}`}
                    className={`h-8 rounded-[4px] text-center font-mono font-semibold tabular-nums transition-shadow hover:ring-2 hover:ring-ring ${
                      n === 0 ? "text-muted-foreground" : ratio > 0.55 ? "text-white" : "text-foreground"
                    }`}
                    style={{ background: heatColor(ratio, "var(--chart-1)") }}
                  >
                    {n || "·"}
                  </td>
                );
              })}
              <td className="text-center font-mono font-semibold text-foreground tabular-nums">{r.total}</td>
            </tr>
          ))}
          <tr>
            <td className={`pt-1 pr-2 ${head}`}>Total</td>
            {zones.map((z) => (
              <td key={z} className="pt-1 text-center font-mono font-semibold text-foreground tabular-nums">
                {zoneTotal(z)}
              </td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ClientMix({ mix }: { mix: DashboardData["mix"] }) {
  const donut = (items: { label: string; count: number }[], center: string, colors?: Record<string, string>) =>
    items.length === 0 ? <Empty /> : <DonutChart items={items} centerLabel={center} size={136} colors={{ [NOT_SET]: "var(--chart-none)", ...colors }} />;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section icon={<Globe />} title="Market type" subtitle="Domestic vs export clients">
          {/* Two series: categorical slots 1 and 2 in fixed order. */}
          {donut(mix.markets, "enquiries", { Domestic: "var(--chart-1)", Export: "var(--chart-2)" })}
        </Section>
        <Section icon={<MapPin />} title="Zone" subtitle="Where the clients are">
          {donut(mix.zones, "enquiries")}
        </Section>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <Section icon={<Users />} title="Primary reps" subtitle="Enquiries per client rep, by status">
          <RepBars reps={mix.reps} />
        </Section>
        <Section className="xl:col-span-2" icon={<Grid3x3 />} title="Reps × zone" subtitle="How many enquiries each rep has in each zone">
          <RepZoneHeatmap mix={mix} />
        </Section>
      </div>
    </div>
  );
}
