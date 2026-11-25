"use client";

// One department's page off the Orders board: its figures, how its SOs are
// spread (status, lateness, age, month, client) and every SO as it stands
// there. Everything is worked out here from the board's rows.

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Search } from "lucide-react";
import {
  BOARD_DEPTS,
  GROUP_LABEL,
  GROUP_STYLE,
  type BoardCell,
  type BoardData,
  type BoardDeptKey,
  type BoardGroup,
  type BoardSo,
} from "@/lib/dept-board-keys";
import { ChartCard, Columns, Donut, HBars, StackBar, VizStyles, type Datum } from "./spare-dashboard/charts";
import { DEPT_ICON } from "./dept-board";

const ORDER: BoardGroup[] = ["overdue", "hold", "progress", "waiting", "done"];
const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Counts into buckets: [label, lowest, highest]. */
function bucket(values: number[], edges: [string, number, number][], color: string) {
  return edges.map(([label, lo, hi]) => ({ label, count: values.filter((v) => v >= lo && v <= hi).length, color }));
}

type Row = { so: BoardSo; cell: BoardCell };

export function DeptDashboard({
  dept,
  data,
  scope,
  backHref,
  query,
}: {
  dept: BoardDeptKey;
  data: BoardData;
  scope: string;
  backHref: string;
  query: string;
}) {
  const meta = BOARD_DEPTS.find((d) => d.key === dept)!;
  const Icon = DEPT_ICON[meta.icon];
  const rows: Row[] = useMemo(
    () => data.sos.map((so) => ({ so, cell: so.cells[dept] })).filter((r) => r.cell.group !== "na"),
    [data, dept]
  );
  const n = rows.length;
  const count = (g: BoardGroup) => rows.filter((r) => r.cell.group === g).length;
  const done = count("done");
  const overdue = rows.filter((r) => r.cell.group === "overdue");
  const avgLate = overdue.length ? Math.round(overdue.reduce((a, r) => a + r.cell.late, 0) / overdue.length) : 0;
  const withTarget = rows.filter((r) => r.cell.target && r.cell.group !== "done");
  const onTrack = withTarget.length ? Math.round(((withTarget.length - overdue.length) / withTarget.length) * 100) : null;
  const open = rows.filter((r) => r.cell.group !== "done");

  const groupData: Datum[] = ORDER.map((g) => ({ label: GROUP_LABEL[g], count: count(g), color: GROUP_STYLE[g].color })).filter((d) => d.count);

  // Each status the department says, coloured by its group.
  const statusData: Datum[] = useMemo(() => {
    const m = new Map<string, { count: number; group: BoardGroup }>();
    for (const r of rows) {
      const e = m.get(r.cell.label) ?? { count: 0, group: r.cell.group };
      e.count += 1;
      m.set(r.cell.label, e);
    }
    return [...m.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([label, e]) => ({ label, count: e.count, color: GROUP_STYLE[e.group].color }));
  }, [rows]);

  const lateBuckets = bucket(
    overdue.map((r) => r.cell.late),
    [["1–7", 1, 7], ["8–15", 8, 15], ["16–30", 16, 30], ["31–60", 31, 60], ["60+", 61, 1e9]],
    "var(--viz-red)"
  );
  const ageBuckets = bucket(
    open.filter((r) => r.so.soDate).map((r) => days(r.so.soDate!, data.today)),
    [["0–15", 0, 15], ["16–30", 16, 30], ["31–60", 31, 60], ["61–90", 61, 90], ["91–180", 91, 180], ["180+", 181, 1e9]],
    "var(--viz-blue)"
  );

  // The last six SO months, each split by group.
  const months = useMemo(() => {
    const keys: string[] = [];
    const d = new Date(`${data.today}T00:00:00Z`);
    for (let i = 5; i >= 0; i--) {
      const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
      keys.push(m.toISOString().slice(0, 7));
    }
    return keys.map((k) => {
      const inMonth = rows.filter((r) => r.so.soDate?.startsWith(k));
      return {
        label: new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
        total: inMonth.length,
        parts: ORDER.slice()
          .reverse()
          .map((g) => ({ label: GROUP_LABEL[g], count: inMonth.filter((r) => r.cell.group === g).length, color: GROUP_STYLE[g].color })),
      };
    });
  }, [rows, data.today]);

  const clients: Datum[] = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of open) m.set(r.so.client || "—", (m.get(r.so.client || "—") ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, c]) => ({ label, count: c, color: "var(--viz-violet)" }));
  }, [open]);

  return (
    <div className="viz space-y-5">
      <VizStyles />
      {/* The heading band. */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#1F3864] via-[#26467d] to-[#2F5496] p-5 text-white shadow-md sm:p-6">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/75 transition hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Orders
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{meta.label}</h1>
            <p className="mt-0.5 text-sm text-white/70">{scope || "All SOs"} · as of {fmtDate(data.today)}</p>
          </div>
          <Ring pct={n ? Math.round((done / n) * 100) : 0} />
        </div>
        {/* The other departments, the same filter. */}
        <nav className="mt-5 flex flex-wrap gap-1.5">
          {BOARD_DEPTS.map((d) => (
            <Link
              key={d.key}
              href={`/risansi/orders/board/${d.key}${query ? `?${query}` : ""}`}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                d.key === dept ? "bg-white text-[#1F3864] shadow-sm" : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
              }`}
            >
              {d.label}
            </Link>
          ))}
        </nav>
      </div>

      {n === 0 ? (
        <p className="rounded-2xl border border-card-border bg-surface px-6 py-12 text-center text-sm text-muted">
          No SO in this view goes through {meta.label}.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Kpi label="SOs" value={n} sub="in this view" accent="var(--viz-violet)" />
            <Kpi label="Done" value={done} sub={`${Math.round((done / n) * 100)}% of SOs`} accent={GROUP_STYLE.done.color} />
            <Kpi label="In progress" value={count("progress")} sub="being worked" accent={GROUP_STYLE.progress.color} />
            <Kpi label="Not started" value={count("waiting")} sub="still to begin" accent={GROUP_STYLE.waiting.color} />
            <Kpi label="Overdue" value={overdue.length} sub={overdue.length ? `avg ${avgLate} days late` : "none past target"} accent={GROUP_STYLE.overdue.color} tone="bad" />
            <Kpi
              label={count("hold") ? "On hold" : "On track"}
              value={count("hold") ? count("hold") : onTrack === null ? "—" : `${onTrack}%`}
              sub={count("hold") ? "waiting on a hold" : "open SOs within target"}
              accent={GROUP_STYLE.hold.color}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Where the SOs stand" sub="Every SO in this department, by status group">
              <Donut data={groupData} centerLabel="SOs" />
            </ChartCard>
            <ChartCard title="Status breakdown" sub={`${meta.label}'s own statuses, most common first`}>
              <HBars data={statusData} />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="How late" sub={overdue.length ? `${overdue.length} overdue SOs by days past target` : "Nothing is past its target"}>
              <Columns data={lateBuckets} xTitle="Days past target" color="var(--viz-red)" />
            </ChartCard>
            <ChartCard title="Age of open SOs" sub={`${open.length} SOs not done, by days since the SO date`}>
              <Columns data={ageBuckets} xTitle="Days since SO date" />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="By SO month" sub="SOs of the last six months and how far each got here">
              <ul className="space-y-2.5">
                {months.map((m) => (
                  <li key={m.label} className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                    <span className="text-muted">{m.label}</span>
                    {m.total ? <StackBar parts={m.parts} title={m.label} /> : <span className="h-2.5 rounded-full bg-[var(--viz-grid)]" />}
                    <span className="text-right text-xs font-semibold tabular-nums text-foreground">{m.total}</span>
                  </li>
                ))}
              </ul>
              <Legend />
            </ChartCard>
            <ChartCard title="Clients with most open SOs" sub="Top eight, SOs not yet done here">
              {clients.length ? <HBars data={clients} /> : <p className="py-6 text-center text-sm text-muted">Every SO is done.</p>}
            </ChartCard>
          </div>

          <SoTable rows={rows} />
        </>
      )}
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-2.5 ring-1 ring-white/15">
      <svg viewBox="0 0 64 64" className="h-14 w-14 -rotate-90" role="img" aria-label={`${pct}% done`}>
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="7" />
        <circle cx="32" cy="32" r={R} fill="none" stroke="#5eead4" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(pct / 100) * C} ${C}`} />
      </svg>
      <div>
        <p className="text-2xl font-bold tabular-nums leading-none">{pct}%</p>
        <p className="mt-1 text-[11px] text-white/70">done</p>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent, tone }: { label: string; value: number | string; sub: string; accent: string; tone?: "bad" }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-card-border bg-surface p-4 shadow-sm">
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${tone === "bad" && value ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-muted">{sub}</p>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      {ORDER.map((g) => (
        <span key={g} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: GROUP_STYLE[g].color }} />
          {GROUP_LABEL[g]}
        </span>
      ))}
    </div>
  );
}

function SoTable({ rows }: { rows: Row[] }) {
  const [group, setGroup] = useState<BoardGroup | "all">("all");
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const list = rows
    .filter((r) => group === "all" || r.cell.group === group)
    .filter((r) => !needle || r.so.soNo.toLowerCase().includes(needle) || r.so.client.toLowerCase().includes(needle) || r.cell.label.toLowerCase().includes(needle))
    .sort((a, b) => ORDER.indexOf(a.cell.group) - ORDER.indexOf(b.cell.group) || b.cell.late - a.cell.late || (a.so.soDate ?? "").localeCompare(b.so.soDate ?? ""));
  return (
    <section className="overflow-hidden rounded-2xl border border-card-border bg-surface shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-card-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">SOs</h2>
        <span className="text-xs text-muted">{list.length} shown</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl bg-background p-1">
            {(["all", ...ORDER] as const).map((g) => {
              const c = g === "all" ? rows.length : rows.filter((r) => r.cell.group === g).length;
              if (g !== "all" && !c) return null;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroup(g)}
                  aria-pressed={group === g}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
                    group === g ? "bg-surface text-foreground shadow-sm ring-1 ring-card-border" : "text-muted hover:text-foreground"
                  }`}
                >
                  {g !== "all" && <span className={`h-2 w-2 rounded-full ${GROUP_STYLE[g].dot}`} />}
                  {g === "all" ? "All" : GROUP_LABEL[g]}
                  <span className="tabular-nums text-muted">{c}</span>
                </button>
              );
            })}
          </div>
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SO, client or status"
              className="h-8 w-48 rounded-lg border border-input-border bg-surface pl-8 pr-2 text-xs text-foreground outline-none focus:border-primary"
            />
          </label>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              {["SO No.", "Client", "Type", "SO Date", "ECs", "Status", "Target", "Late"].map((h) => (
                <th key={h} className="border-b border-card-border bg-background/60 px-4 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map(({ so, cell }) => {
              const st = GROUP_STYLE[cell.group];
              return (
                <tr key={so.id} className="border-b border-card-border/70 transition-colors last:border-0 hover:bg-background/60">
                  <td className="px-4 py-2.5">
                    <Link href={`/risansi/orders/${so.id}`} className="group inline-flex items-center gap-1 font-semibold text-foreground hover:text-[#2F5496] dark:hover:text-sky-300">
                      {so.soNo}
                      <ArrowUpRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                    </Link>
                    {so.cvHold && <span className="ml-1.5 rounded bg-rose-50 px-1 text-[9.5px] font-semibold uppercase text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">CV hold</span>}
                  </td>
                  <td className="max-w-[16rem] truncate px-4 py-2.5 text-foreground">{so.client || "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{so.orderType || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">{fmtDate(so.soDate)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">{cell.ecTotal ? `${cell.ecDone}/${cell.ecTotal}` : so.ecs || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${st.chip}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                      {cell.label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">{fmtDate(cell.target)}</td>
                  <td className="px-4 py-2.5">
                    {cell.late > 0 ? (
                      <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">{cell.late}d</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!list.length && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">
                  No SOs match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
