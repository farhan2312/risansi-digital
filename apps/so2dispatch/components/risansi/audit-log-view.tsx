"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FileDown, Loader2, X } from "lucide-react";
import { UrlPagination, UrlSearchInput, useUrlTable } from "./url-table";
import { roleLabel } from "@/lib/roles";
import type { AuditEvent, AuditStats, AuditUserRow } from "@/lib/audit";
import type { PageResult } from "@/lib/pagination";
import { AUDIT_RANGES, AUDIT_TABS, DEFAULT_AUDIT_TAB } from "@/lib/audit-range";
import type { AuditOverview } from "@/lib/audit-overview";
import { AuditOverviewPanel } from "./audit-overview";
import {
  ACTION_META,
  ACTIVE_GAP_MINUTES,
  formatActiveMinutes,
  type AuditTone,
} from "@/lib/audit-labels";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TONE: Record<AuditTone, string> = {
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-rose-50 text-rose-700",
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  neutral: "bg-slate-100 text-slate-600",
};

function ActionChip({ action }: { action: string }) {
  const meta = ACTION_META[action] ?? { label: action, tone: "neutral" as AuditTone };
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[meta.tone]}`}
    >
      {meta.label}
    </span>
  );
}

/**
 * Where an event came from: the address, and the device and browser beneath
 * it. Events from before either was recorded say so rather than showing a
 * blank that could read as "no address".
 */
function OriginCell({
  ip,
  device,
  browser,
  os,
}: {
  ip: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
}) {
  if (!ip && !device) {
    return <span className="text-xs italic text-muted-foreground">not recorded</span>;
  }
  const machine = [device, browser, os].filter(Boolean).join(" · ");
  return (
    <div className="leading-tight">
      <div className="font-mono text-xs text-foreground">{ip ?? "—"}</div>
      {machine && <div className="mt-0.5 text-[11px] text-muted">{machine}</div>}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-card-border bg-surface p-5 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="mt-1 font-display text-3xl font-bold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

/**
 * The SO and EC an event touched, each a link while it still exists. An event
 * on a deleted order keeps its name but loses the link — the id no longer
 * leads anywhere.
 */
function SubjectCell({ e }: { e: AuditEvent }) {
  if (!e.so_no) {
    // An order event with no SO is an old row: it was logged before the order
    // was recorded, and nothing left in the database says which one it was.
    return e.action.startsWith("order.") ? (
      <span
        className="text-xs italic text-muted-foreground"
        title="Logged before SO / EC were recorded with each event"
      >
        not recorded
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  }
  return (
    <div className="flex flex-col leading-tight">
      {e.order_live ? (
        <Link
          href={`/risansi/orders/${e.order_id}`}
          className="font-medium text-primary hover:text-primary-hover"
        >
          {e.so_no}
        </Link>
      ) : (
        <span className="font-medium">{e.so_no}</span>
      )}
      {e.ec_no &&
        (e.order_live && e.item_live ? (
          <Link
            href={`/risansi/orders/${e.order_id}/items/${e.item_id}`}
            className="text-xs text-primary/80 hover:text-primary-hover"
          >
            {e.ec_no}
          </Link>
        ) : (
          <span className="text-xs text-muted">{e.ec_no}</span>
        ))}
    </div>
  );
}

/**
 * "Updated Planning — Planning Status: In plan → Assembled; …" — the headline
 * on one line and each change beneath it, so a save that touched eight fields
 * reads as a list rather than a paragraph.
 */
function DetailsCell({ text }: { text: string | null }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  const split = text.indexOf(" — ");
  if (split < 0 || !text.includes("→")) return <span>{text}</span>;
  const head = text.slice(0, split);
  const changes = text.slice(split + 3).split("; ");
  return (
    <div>
      <div className="text-foreground">{head}</div>
      <ul className="mt-0.5 space-y-0.5 text-xs text-muted">
        {changes.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </div>
  );
}

export function AuditLogView({
  stats,
  tab,
  range,
  from,
  to,
  overview,
  users,
  events,
}: {
  stats: AuditStats;
  tab: string;
  range: string;
  /** A custom period, which replaces the preset while either end is set. */
  from: string | null;
  to: string | null;
  // Exactly one of these is populated — whichever tab is on screen.
  overview: AuditOverview | null;
  users: PageResult<AuditUserRow> | null;
  events: PageResult<AuditEvent> | null;
}) {
  const { setParams, pending } = useUrlTable();
  const params = useSearchParams();
  // Changing a tab or a range is a server round trip, so the button has to
  // show the click straight away rather than sitting inert until the rows come
  // back. `pending` is the whole reset: while the transition runs the clicked
  // value wins, and once the props are authoritative again a stale intent is
  // simply ignored.
  const [wantTab, setWantTab] = useState<string | null>(null);
  const [wantRange, setWantRange] = useState<string | null>(null);
  const custom = !!(from || to);
  const shownTab = pending && wantTab ? wantTab : tab;
  const shownRange = pending && wantRange ? wantRange : custom ? null : range;

  const isOverview = tab === "overview";
  const isByUser = tab === "by_user";
  // Sign-ins and ownership changes are about people, not orders.
  const showSubject = tab === "activity";
  const result = (isByUser ? users : events) ?? {
    rows: [],
    total: 0,
    page: 1,
    pageSize: 0,
    totalPages: 1,
    from: 0,
    to: 0,
  };
  const pageRows = result.rows;

  // The report prints exactly what the screen is filtered to.
  const reportQs = new URLSearchParams(params?.toString() ?? "");
  reportQs.delete("page");
  const reportQuery = reportQs.toString();
  const reportHref = `/risansi/audit-log/report${reportQuery ? `?${reportQuery}` : ""}`;

  // Aggregation, filtering and paging all happen in SQL now.
  const summary = isByUser
    ? `${result.total} user${result.total === 1 ? "" : "s"} active`
    : `${result.total} event${result.total === 1 ? "" : "s"}`;
  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Audit Log
          </h1>
          <p className="text-sm text-muted">
            Full activity trail · who signed in, when, and everything they did
          </p>
        </div>
        {/* A plain link: the route answers with the file, and the browser
            downloads it without leaving the page. */}
        <a
          href={reportHref}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <FileDown className="h-4 w-4" />
          Download report (PDF)
        </a>
      </div>

      {/* stat cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Logins · 24h" value={stats.logins} />
        <StatCard label="Failed · 24h" value={stats.failed} />
        <StatCard label="Active Users · 24h" value={stats.activeUsers} />
        <StatCard label="Actions · 24h" value={stats.actions} />
      </div>

      {/* tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-card-border">
        {AUDIT_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setWantTab(t.key);
              // Search and paging belong to the tab being left.
              setParams({ tab: t.key === DEFAULT_AUDIT_TAB ? null : t.key, q: null, page: null });
            }}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              shownTab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
            {shownTab === t.key && pending && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
          </button>
        ))}
      </div>

      {/* period + search */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {AUDIT_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => {
                setWantRange(r.key);
                // A preset replaces any custom period.
                setParams({ range: r.key === "7d" ? null : r.key, from: null, to: null });
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                shownRange === r.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input-border text-foreground hover:bg-background"
              }`}
            >
              {r.label}
              {shownRange === r.key && pending && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
            </button>
          ))}

          <span className="mx-1 h-5 w-px bg-card-border" aria-hidden />
          <label className="inline-flex items-center gap-1.5 text-xs text-muted">
            From
            <input
              type="date"
              value={from ?? ""}
              max={to ?? undefined}
              onChange={(e) => setParams({ from: e.target.value || null, range: null })}
              className={`h-8 rounded-lg border bg-surface px-2 text-xs text-foreground focus:border-primary focus:outline-none ${
                from ? "border-primary" : "border-input-border"
              }`}
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted">
            To
            <input
              type="date"
              value={to ?? ""}
              min={from ?? undefined}
              onChange={(e) => setParams({ to: e.target.value || null, range: null })}
              className={`h-8 rounded-lg border bg-surface px-2 text-xs text-foreground focus:border-primary focus:outline-none ${
                to ? "border-primary" : "border-input-border"
              }`}
            />
          </label>
          {custom && (
            <button
              type="button"
              onClick={() => setParams({ from: null, to: null })}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-input-border px-2 text-xs font-medium text-foreground hover:bg-background"
            >
              <X className="h-3.5 w-3.5" />
              Clear dates
            </button>
          )}
        </div>
        {/* The 'By user' tab has no event columns — its rows are just user
            identity + role, so the placeholder shifts to match. The overview
            summarises the whole period, so it has nothing to search. */}
        {!isOverview && (
        <UrlSearchInput
          placeholder={
            isByUser
              ? "Search name, email, role, IP…"
              : showSubject
                ? "Search SO, EC, user, details…"
                : "Search user, details, IP…"
          }
        />
        )}
      </div>

      {isOverview && overview ? (
        <div className={pending ? "opacity-60 transition-opacity" : ""}>
          <AuditOverviewPanel data={overview} />
        </div>
      ) : (
      <>
      <p className="mb-3 text-sm text-muted">{summary}</p>

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          {isByUser ? (
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Actions</th>
                  <th className="px-4 py-3">Sessions</th>
                  <th
                    className="px-4 py-3"
                    title={`Gaps of ${ACTIVE_GAP_MINUTES} minutes or less between a user's consecutive actions, added up. A longer gap means they stepped away and does not count.`}
                  >
                    Active Time
                  </th>
                  <th className="px-4 py-3">Last Active</th>
                  <th className="px-4 py-3">Last IP / Device</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">
                      No activity in this range.
                    </td>
                  </tr>
                )}
                {(pageRows as AuditUserRow[]).map((u) => (
                  <tr key={u.email} className="text-foreground">
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.name ?? u.email}</div>
                      {u.name && <div className="text-xs text-muted">{u.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {u.role ? roleLabel(u.role) : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{u.actions}</td>
                    <td className="px-4 py-3 tabular-nums">{u.sessions}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatActiveMinutes(u.activeMinutes)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {fmt(u.lastActive)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {u.lastIp || u.lastDevice ? (
                        <div className="leading-tight">
                          <div className="font-mono text-xs text-foreground">
                            {u.lastIp ?? "—"}
                            {u.ipCount > 1 && (
                              <span
                                className="ml-1.5 font-sans text-[11px] text-muted"
                                title={`Seen from ${u.ipCount} addresses in this period`}
                              >
                                +{u.ipCount - 1} more
                              </span>
                            )}
                          </div>
                          {u.lastDevice && (
                            <div className="mt-0.5 text-[11px] text-muted">{u.lastDevice}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">not recorded</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[1120px] text-sm">
              <thead>
                <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Event</th>
                  {showSubject && <th className="px-4 py-3">SO / EC</th>}
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3">IP / Device</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {pageRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={showSubject ? 6 : 5}
                      className="px-4 py-10 text-center text-sm text-muted"
                    >
                      No events in this range.
                    </td>
                  </tr>
                )}
                {(pageRows as AuditEvent[]).map((e) => (
                  <tr key={e.id} className="align-top text-foreground">
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {fmt(e.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div>{e.user_email ?? "—"}</div>
                      {e.user_role && (
                        <div className="text-xs text-muted">{roleLabel(e.user_role)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ActionChip action={e.action} />
                    </td>
                    {showSubject && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        <SubjectCell e={e} />
                      </td>
                    )}
                    <td className="px-4 py-3 text-muted">
                      <DetailsCell text={e.details} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <OriginCell
                        ip={e.ip_address}
                        device={e.device_type}
                        browser={e.browser}
                        os={e.os}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <UrlPagination
          page={result.page}
          totalPages={result.totalPages}
          from={result.from}
          to={result.to}
          total={result.total}
        />
      </div>
      </>
      )}
    </div>
  );
}
