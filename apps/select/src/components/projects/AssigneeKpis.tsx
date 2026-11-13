"use client";

import { useEffect, useMemo, useState } from "react";

import { UsersRound } from "lucide-react";

import apiClient from "../../services/apiClient";
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs";
import { Button } from "@/components/shadcn/button";
import { roleLabel } from "../../lib/roles";
import type { AssigneeStats, StatusCounts } from "../../lib/assignee-stats";

// Enquiries page, User-Master / system admins: one KPI card per person
// enquiries go to - the enquiries assigned to them in the period (Daily = today,
// All time, or a picked range; by assigned date). Pumps by Technical and Commercial
// status; spares by their one status.

type Period = "daily" | "all" | "range";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Local-day boundaries as ISO instants. */
const dayStart = (v: string) => new Date(`${v}T00:00:00`).toISOString();
const dayEnd = (v: string) => new Date(`${v}T23:59:59.999`).toISOString();

const STATUS = [
  { key: "pending", label: "Pending", color: "var(--sc-warning)" },
  { key: "inProgress", label: "In progress", color: "var(--sc-info)" },
  { key: "completed", label: "Completed", color: "var(--sc-success)" },
  { key: "sentToClient", label: "Sent to client", color: "var(--sc-primary)" },
  { key: "notQuoted", label: "Not quoted", color: "var(--sc-muted-foreground)" },
  { key: "regret", label: "Regret", color: "var(--sc-destructive)" },
] as const;

function StatusBar({ counts }: { counts: StatusCounts }) {
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      {counts.total > 0 &&
        STATUS.map((s) =>
          counts[s.key] > 0 ? (
            <span key={s.key} style={{ width: `${(counts[s.key] / counts.total) * 100}%`, background: s.color }} className="h-full transition-[width] duration-500" />
          ) : null,
        )}
    </div>
  );
}

/** A label over a thin status bar and the counts, coloured: the last two only when there are any. */
function StatusRow({ label, counts }: { label: string; counts: StatusCounts }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-2 font-mono font-medium tabular-nums">
          {STATUS.map((s, i) =>
            i < 3 || counts[s.key] > 0 ? (
              <span key={s.key} style={{ color: s.color }} title={`${s.label}: ${counts[s.key]}`}>
                {counts[s.key]}
              </span>
            ) : null,
          )}
        </span>
      </div>
      <StatusBar counts={counts} />
    </div>
  );
}

/** "Pump 8" over its status rows. */
function OrderSection({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-border pt-2">
      <div className="flex items-center justify-between gap-2 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
        <span>{label}</span>
        <span className="font-mono text-[13px] font-semibold tracking-normal text-foreground tabular-nums">{count}</span>
      </div>
      {children}
    </div>
  );
}

function AssigneeCard({ s }: { s: AssigneeStats }) {
  const name = s.name || s.email;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <div className="min-w-[200px] flex-1 rounded-md border border-border bg-card px-3 py-2.5 transition-[border-color,box-shadow] hover:border-input hover:shadow-[0_4px_14px_rgba(15,23,42,0.07)]">
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary ring-1 ring-primary/15">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-foreground" title={name}>
            {name}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{roleLabel(s.role)}</div>
        </div>
        <span className="font-mono text-[20px] leading-none font-semibold text-foreground tabular-nums" title="Enquiries">
          {s.enquiries}
        </span>
      </div>
      <div className="mt-2 space-y-2">
        <OrderSection label="Pump" count={s.pump.technical.total}>
          <StatusRow label="Technical" counts={s.pump.technical} />
          <StatusRow label="Commercial" counts={s.pump.commercial} />
        </OrderSection>
        <OrderSection label="Spare" count={s.spare.total}>
          <StatusRow label="Status" counts={s.spare} />
        </OrderSection>
      </div>
    </div>
  );
}

export default function AssigneeKpis({ own = false }: { /** A worker: just their own card. */ own?: boolean }) {
  const [period, setPeriod] = useState<Period>("daily");
  const [fromDate, setFromDate] = useState(() => ymd(new Date()));
  const [toDate, setToDate] = useState(() => ymd(new Date()));
  const [rows, setRows] = useState<AssigneeStats[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(true);

  const window = useMemo(() => {
    if (period === "all") return {};
    if (period === "daily") {
      const today = ymd(new Date());
      return { from: dayStart(today), to: dayEnd(today) };
    }
    return { from: fromDate ? dayStart(fromDate) : undefined, to: toDate ? dayEnd(toDate) : undefined };
  }, [period, fromDate, toDate]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFailed(false);
    apiClient
      .get<AssigneeStats[]>("/projects/assignee-stats", { params: window })
      .then((r) => !cancelled && setRows(r.data))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [window, open]);

  const periodText =
    period === "daily" ? "assigned today" : period === "all" ? "assigned, all time" : `assigned ${fromDate || "start"} → ${toDate || "today"}`;
  const totals = (rows ?? []).reduce((t, r) => ({ e: t.e + r.enquiries, p: t.p + r.pump.technical.total, s: t.s + r.spare.total }), { e: 0, p: 0, s: 0 });

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className={`flex flex-wrap items-center gap-3 bg-muted/40 px-4 py-2.5 ${open ? "border-b border-border" : ""}`}>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <UsersRound className="size-4 text-muted-foreground" aria-hidden />
            {own ? "My workload" : "Team workload"}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {rows ? (
              <>
                <b className="font-mono font-semibold text-foreground tabular-nums">{totals.e}</b> enquir{totals.e === 1 ? "y" : "ies"} · <b className="font-mono font-semibold text-foreground tabular-nums">{totals.p}</b> pump · <b className="font-mono font-semibold text-foreground tabular-nums">{totals.s}</b> spare {periodText}
              </>
            ) : (
              `Enquiries ${periodText}, by person`
            )}
          </p>
        </div>
        {open && (
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <TabsList aria-label="Period">
                <TabsTrigger value="daily">Daily</TabsTrigger>
                <TabsTrigger value="all">All time</TabsTrigger>
                <TabsTrigger value="range">Pick range</TabsTrigger>
              </TabsList>
            </Tabs>
            {period === "range" && (
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <input
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => setFromDate(e.target.value)}
                  aria-label="From"
                  className="h-8 rounded-md border border-input bg-card px-2 font-mono text-[12px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
                />
                →
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  aria-label="To"
                  className="h-8 rounded-md border border-input bg-card px-2 font-mono text-[12px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
                />
              </span>
            )}
          </div>
        )}
        {open && (
          <span className="hidden items-center gap-2.5 text-[11px] text-muted-foreground md:flex" aria-hidden>
            {STATUS.map((s) => (
              <span key={s.key} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </Button>
      </div>

      {open && (
        <div className="px-4 py-3">
          {failed && <p className="text-[12.5px] text-destructive">Couldn&apos;t load the team workload.</p>}
          {!failed && rows === null && (
            <div className={`flex gap-2.5 overflow-x-auto pb-1 ${own ? "max-w-[380px]" : ""}`}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[180px] min-w-[200px] flex-1 animate-pulse rounded-md border border-border bg-muted/60" />
              ))}
            </div>
          )}
          {!failed && rows && rows.length === 0 && <p className="text-[12.5px] text-muted-foreground">{own ? "Nothing assigned to you yet." : "Nobody to assign enquiries to yet."}</p>}
          {!failed && rows && rows.length > 0 && (
            <div className={`flex gap-2.5 overflow-x-auto pb-1 ${own ? "max-w-[380px]" : ""}`}>
              {rows.map((s) => (
                <AssigneeCard key={s.userId} s={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
