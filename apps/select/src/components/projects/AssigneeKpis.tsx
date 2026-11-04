"use client";

import { useEffect, useMemo, useState } from "react";

import apiClient from "../../services/apiClient";
import { Segmented } from "../../screens/admin/audit/auditUi";
import { roleLabel } from "../../lib/roles";
import type { AssigneeStats, StatusCounts } from "../../lib/assignee-stats";

// Enquiries page, User-Master / system admins: one KPI card per person
// enquiries go to - the enquiries assigned to them in the period (Daily = today,
// All time, or a picked range; by assigned date). Pumps by Technical and Commercial
// status, with their tags by status; spares by their one status.

type Period = "daily" | "all" | "range";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Local-day boundaries as ISO instants. */
const dayStart = (v: string) => new Date(`${v}T00:00:00`).toISOString();
const dayEnd = (v: string) => new Date(`${v}T23:59:59.999`).toISOString();

const STATUS = [
  { key: "pending", label: "Pending", color: "var(--warn)" },
  { key: "inProgress", label: "In progress", color: "var(--brand-blue)" },
  { key: "completed", label: "Completed", color: "var(--pos)" },
] as const;

function StatusBar({ counts }: { counts: StatusCounts }) {
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-sunk" aria-hidden>
      {counts.total > 0 &&
        STATUS.map((s) =>
          counts[s.key] > 0 ? (
            <span key={s.key} style={{ width: `${(counts[s.key] / counts.total) * 100}%`, background: s.color }} className="h-full transition-[width] duration-500" />
          ) : null,
        )}
    </div>
  );
}

/** A label over a thin status bar and the three counts, coloured. */
function StatusRow({ label, counts }: { label: string; counts: StatusCounts }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-medium text-fg-3">{label}</span>
        <span className="flex items-center gap-2 font-mono font-semibold">
          {STATUS.map((s) => (
            <span key={s.key} style={{ color: s.color }} title={`${s.label}: ${counts[s.key]}`}>
              {counts[s.key]}
            </span>
          ))}
        </span>
      </div>
      <StatusBar counts={counts} />
    </div>
  );
}

/** "Pump 8" over its status rows. */
function OrderSection({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-line pt-2">
      <div className="flex items-center justify-between gap-2 text-[10.5px] font-semibold tracking-[0.08em] text-fg-2 uppercase">
        <span>{label}</span>
        <span className="font-mono text-[13px] tracking-normal text-title">{count}</span>
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
    <div className="min-w-[200px] flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 transition hover:border-[color-mix(in_srgb,var(--brand-blue)_35%,var(--line))] hover:shadow-[0_6px_18px_rgba(10,22,40,0.07)]">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--brand-blue)] to-[var(--brand-cyan)] text-[10.5px] font-bold text-white">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-fg" title={name}>
            {name}
          </div>
          <div className="truncate text-[10.5px] text-fg-4">{roleLabel(s.role)}</div>
        </div>
        <span className="font-mono text-[20px] leading-none font-bold text-title" title="Enquiries">
          {s.enquiries}
        </span>
      </div>
      <div className="mt-2 space-y-2">
        <OrderSection label="Pump" count={s.pump.technical.total}>
          <StatusRow label="Technical" counts={s.pump.technical} />
          <StatusRow label="Commercial" counts={s.pump.commercial} />
          <StatusRow label={`Tags ${s.pump.tags.total}`} counts={s.pump.tags} />
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
  const totals = (rows ?? []).reduce((t, r) => ({ e: t.e + r.enquiries, p: t.p + r.pump.technical.total, s: t.s + r.spare.total, g: t.g + r.pump.tags.total }), { e: 0, p: 0, s: 0, g: 0 });

  return (
    <section className="mt-4 rounded-2xl border border-line bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent-soft)_55%,var(--bg-paper))_0%,var(--bg-paper)_70%)] px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-accent" aria-hidden>
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20c0-3-1.9-5.5-4.5-6.3" />
            </svg>
            {own ? "My workload" : "Team workload"}
          </h2>
          <p className="mt-0.5 text-[12px] text-fg-3">
            {rows ? (
              <>
                <b className="font-mono text-fg">{totals.e}</b> enquir{totals.e === 1 ? "y" : "ies"} · <b className="font-mono text-fg">{totals.p}</b> pump (<b className="font-mono text-fg">{totals.g}</b> tag
                {totals.g === 1 ? "" : "s"}) · <b className="font-mono text-fg">{totals.s}</b> spare {periodText}
              </>
            ) : (
              `Enquiries ${periodText}, by person`
            )}
          </p>
        </div>
        {open && (
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={period}
              onChange={setPeriod}
              options={[
                { key: "daily", label: "Daily" },
                { key: "all", label: "All time" },
                { key: "range", label: "Pick range" },
              ]}
            />
            {period === "range" && (
              <span className="flex items-center gap-1.5 text-[12px] text-fg-3">
                <input
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => setFromDate(e.target.value)}
                  aria-label="From"
                  className="h-8 rounded-lg border border-line bg-paper px-2 text-[12.5px] text-fg outline-none focus:border-accent"
                />
                →
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  aria-label="To"
                  className="h-8 rounded-lg border border-line bg-paper px-2 text-[12.5px] text-fg outline-none focus:border-accent"
                />
              </span>
            )}
          </div>
        )}
        {open && (
          <span className="hidden items-center gap-2.5 text-[11px] text-fg-3 md:flex" aria-hidden>
            {STATUS.map((s) => (
              <span key={s.key} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md px-2 py-1 text-[12px] font-semibold text-accent hover:bg-accent-soft"
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          {failed && <p className="text-[12.5px] text-neg">Couldn&apos;t load the team workload.</p>}
          {!failed && rows === null && (
            <div className={`flex gap-2.5 overflow-x-auto pb-1 ${own ? "max-w-[380px]" : ""}`}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[210px] min-w-[200px] flex-1 animate-pulse rounded-xl border border-line bg-paper" />
              ))}
            </div>
          )}
          {!failed && rows && rows.length === 0 && <p className="text-[12.5px] text-fg-3">{own ? "Nothing assigned to you yet." : "Nobody to assign enquiries to yet."}</p>}
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
