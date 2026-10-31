"use client";

import { DonutChart, fmtNum, heatColor } from "../../components/charts/charts";
import { Card, Icons } from "../admin/audit/auditUi";
import type { DashboardData } from "../../services/dashboardService";

// Dashboard "Client mix": who the enquiries in scope are for - order type,
// market type and zone as donuts, primary reps with their enquiries' status,
// and a rep x zone heatmap. Follows the Dashboard's filters, period and scope.

const STATUS = [
  { key: "pending", label: "Pending", color: "var(--warn)" },
  { key: "inProgress", label: "In progress", color: "var(--brand-blue)" },
  { key: "completed", label: "Completed", color: "var(--pos)" },
] as const;

const NOT_SET = "Not set";

function Empty() {
  return <p className="py-8 text-center text-[12.5px] text-fg-3">Nothing in this period</p>;
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
              <span className={`min-w-0 truncate ${r.label === NOT_SET ? "text-fg-4 italic" : "font-medium text-fg-2"}`}>{r.label}</span>
              <span className="shrink-0 font-mono font-semibold text-fg tabular-nums">{fmtNum(r.total)}</span>
            </div>
            {/* Bar length = share of the busiest rep; segments = status. */}
            <div className="h-2 overflow-hidden rounded-full bg-sunk">
              <div className="flex h-full transition-[width] duration-500" style={{ width: `${(r.total / max) * 100}%` }}>
                {STATUS.map((s) =>
                  r[s.key] > 0 ? (
                    <span key={s.key} title={`${s.label}: ${r[s.key]}`} style={{ width: `${(r[s.key] / r.total) * 100}%`, background: s.color }} className="h-full" />
                  ) : null,
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-3 text-[11px] text-fg-3">
        {STATUS.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
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
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-[12px]">
        <thead>
          <tr>
            <th className="w-[1%] pr-2 text-left text-[10.5px] font-semibold tracking-[0.06em] whitespace-nowrap text-fg-3 uppercase">Rep \ Zone</th>
            {zones.map((z) => (
              <th key={z} className={`min-w-[64px] px-1 text-center text-[11px] font-semibold ${z === NOT_SET ? "text-fg-4 italic" : "text-fg-2"}`}>
                {z}
              </th>
            ))}
            <th className="min-w-[48px] text-center text-[10.5px] font-semibold tracking-[0.06em] text-fg-3 uppercase">Total</th>
          </tr>
        </thead>
        <tbody>
          {mix.reps.map((r) => (
            <tr key={r.label}>
              <td className={`max-w-[170px] truncate pr-2 whitespace-nowrap ${r.label === NOT_SET ? "text-fg-4 italic" : "font-medium text-fg-2"}`} title={r.label}>
                {r.label}
              </td>
              {zones.map((z) => {
                const n = at.get(`${r.label}|${z}`) ?? 0;
                const ratio = n / max;
                return (
                  <td
                    key={z}
                    title={`${r.label} · ${z}: ${n}`}
                    className={`h-8 rounded-md text-center font-mono font-semibold tabular-nums transition-transform hover:scale-105 ${
                      n === 0 ? "text-fg-4" : ratio > 0.55 ? "text-white" : "text-fg"
                    }`}
                    style={{ background: heatColor(ratio) }}
                  >
                    {n || "·"}
                  </td>
                );
              })}
              <td className="text-center font-mono font-bold text-fg tabular-nums">{r.total}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-1 pr-2 text-[10.5px] font-semibold tracking-[0.06em] text-fg-3 uppercase">Total</td>
            {zones.map((z) => (
              <td key={z} className="pt-1 text-center font-mono font-bold text-fg tabular-nums">
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
    items.length === 0 ? <Empty /> : <DonutChart items={items} centerLabel={center} size={136} colors={{ [NOT_SET]: "var(--fg-4)", ...colors }} />;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card icon={Icons.tag} title="Order type" subtitle="Pump vs spare orders">
          {donut(mix.orderTypes, "enquiries", { Pump: "var(--brand-blue)", Spare: "var(--warn)" })}
        </Card>
        <Card icon={Icons.globe} title="Market type" subtitle="Domestic vs export clients">
          {donut(mix.markets, "enquiries", { Domestic: "var(--brand-cyan)", Export: "var(--purple)" })}
        </Card>
        <Card icon={Icons.flame} title="Zone" subtitle="Where the clients are">
          {donut(mix.zones, "enquiries")}
        </Card>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <Card icon={Icons.users} title="Primary reps" subtitle="Enquiries per client rep, by status">
          <RepBars reps={mix.reps} />
        </Card>
        <Card className="xl:col-span-2" icon={Icons.overview} title="Reps × zone" subtitle="How many enquiries each rep has in each zone">
          <RepZoneHeatmap mix={mix} />
        </Card>
      </div>
    </div>
  );
}
