"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import EmptyState from "../../components/ui/EmptyState";
import Pagination from "../../components/ui/Pagination";
import { SkeletonRows } from "../../components/ui/Skeleton";
import {
  getAuditLog,
  getAuditReport,
  type AuditEventRow,
  type AuditOverview,
  type AuditSummary,
  type AuditUsageRow,
} from "../../services/auditService";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import { formatDuration } from "../../lib/duration";
import { downloadAuditReportPdf } from "../../lib/audit-report-pdf";
import AuditOverviewTab from "./audit/AuditOverviewTab";
import {
  ActionBadge,
  DeviceCell,
  fmtAgo,
  fmtWhen,
  Icons,
  IpChip,
  RoleBadge,
  UserCell,
} from "./audit/auditUi";

type TabKey = "overview" | "usage" | "activity" | "logins" | "access";
type RangeKey = "today" | "week" | "month" | "7d" | "30d" | "all";

// Rows per page. The server pages to the same size; this only labels the bar.
const PAGE_SIZE = 30;

const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  { key: "overview", label: "Overview", icon: Icons.overview },
  { key: "usage", label: "Usage by User", icon: Icons.users },
  { key: "activity", label: "Activity", icon: Icons.activity },
  { key: "logins", label: "Logins & Sessions", icon: Icons.login },
  // The pump portal's equivalent of an "ownership changes" view: who was
  // granted, re-roled or lost access.
  { key: "access", label: "Access Changes", icon: Icons.shield },
];

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
];

/**
 * A picked calendar date -> the instant it starts or ends IN THE USER'S TIME
 * ZONE. `new Date("2026-09-01")` would be UTC midnight, which is the wrong day
 * for anyone east or west of UTC, so the parts are built explicitly.
 */
const dayBoundary = (ymd: string, edge: "start" | "end"): string | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const dt =
    edge === "start" ? new Date(y, mo, d, 0, 0, 0, 0) : new Date(y, mo, d, 23, 59, 59, 999);
  return dt.toISOString();
};

const TH = "border-b border-line bg-elev px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3 whitespace-nowrap";
const TD = "px-4 py-2.5 align-middle";

const AuditLogPage = () => {
  const { user } = useCurrentUser();
  const [tab, setTab] = useState<TabKey>("overview");
  const [range, setRange] = useState<RangeKey>("7d");
  // Explicit From/To dates (YYYY-MM-DD, from <input type="date">). When either
  // is set it overrides the quick range chip.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [showActiveHelp, setShowActiveHelp] = useState(false);

  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [overview, setOverview] = useState<AuditOverview | null>(null);
  const [usageRows, setUsageRows] = useState<AuditUsageRow[]>([]);
  const [eventRows, setEventRows] = useState<AuditEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const customDates = Boolean(fromDate || toDate);
  const timeWindow = useMemo(
    () => ({
      range,
      from: fromDate ? dayBoundary(fromDate, "start") : undefined,
      to: toDate ? dayBoundary(toDate, "end") : undefined,
    }),
    [range, fromDate, toDate],
  );

  // Any filter change goes back to page 1 - a narrower filter can leave the
  // current page past the end of the results.
  const filterKey = `${tab}|${timeWindow.range}|${timeWindow.from}|${timeWindow.to}|${debouncedSearch.trim()}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    // Reset during render (not in an effect) so the fetch below never fires
    // once for the stale page number first.
    setLastFilterKey(filterKey);
    setPage(1);
  }

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getAuditLog({
      tab,
      ...timeWindow,
      // The overview covers the whole window; search doesn't apply to it.
      q: tab === "overview" ? "" : debouncedSearch.trim(),
      page,
    })
      .then((res) => {
        if (cancelled) return;
        setSummary(res.summary);
        setTotal(res.total);
        if (tab === "overview") {
          setOverview(res.overview ?? null);
        } else if (tab === "usage") {
          setUsageRows(res.rows as AuditUsageRow[]);
          setEventRows([]);
        } else {
          setEventRows(res.rows as AuditEventRow[]);
          setUsageRows([]);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the audit log.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, timeWindow, debouncedSearch, page]);

  // The report covers the same window as the table, across EVERY section - not
  // just the tab in view - so it is a complete record for that period.
  const handleGenerateReport = async () => {
    if (generating) return;
    setGenerating(true);
    setReportError(null);
    try {
      const report = await getAuditReport(timeWindow);
      await downloadAuditReportPdf({ report, generatedBy: user?.name || user?.email });
    } catch {
      setReportError("Couldn't generate the report. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const live = [
    { label: "Sign-ins", value: summary?.logins24h ?? 0, icon: Icons.login, tone: "text-[var(--brand-cyan)]" },
    { label: "Failed", value: summary?.failed24h ?? 0, icon: Icons.alert, tone: (summary?.failed24h ?? 0) > 0 ? "text-neg" : "text-fg-3" },
    { label: "Active users", value: summary?.activeUsers24h ?? 0, icon: Icons.users, tone: "text-[var(--purple)]" },
    { label: "Actions", value: summary?.actions24h ?? 0, icon: Icons.activity, tone: "text-accent" },
  ];

  const pageRows = tab === "usage" ? usageRows.length : eventRows.length;
  const windowLabel = customDates
    ? `${fromDate || "the beginning"} to ${toDate || "today"}`
    : RANGES.find((r) => r.key === range)?.label ?? range;
  const maxActive = Math.max(1, ...usageRows.map((r) => r.activeSeconds));

  const pickRange = (key: RangeKey) => {
    setRange(key);
    // A quick range replaces any custom dates, rather than silently being
    // overridden by them.
    setFromDate("");
    setToDate("");
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-5 pb-10 sm:px-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-paper">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(1000px 220px at 0% 0%, color-mix(in srgb, var(--brand-blue) 12%, transparent), transparent 70%), radial-gradient(600px 200px at 100% 0%, color-mix(in srgb, var(--brand-cyan) 12%, transparent), transparent 70%)",
          }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4 px-5 pt-5 pb-4">
          <div className="flex items-center gap-3.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--brand-blue)] to-[var(--brand-cyan)] text-white shadow-[0_6px_18px_color-mix(in_srgb,var(--brand-blue)_35%,transparent)]">
              {Icons.shield}
            </span>
            <div>
              <h1 className="text-[22px] font-bold leading-tight text-fg">Audit Log</h1>
              <p className="mt-0.5 text-[13px] text-fg-3">
                Full activity trail · who signed in, from where, and everything they did
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleGenerateReport()}
            disabled={generating}
            title={`Download a detailed PDF for: ${windowLabel}`}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold whitespace-nowrap text-white shadow-[0_1px_2px_rgba(10,61,143,0.15)] transition hover:-translate-y-px hover:shadow-[0_6px_16px_color-mix(in_srgb,var(--brand-blue)_30%,transparent)] disabled:cursor-progress disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {Icons.download}
            {generating ? "Generating…" : "Generate Report"}
          </button>
        </div>

        {/* Live strip: always the last 24 hours */}
        <div className="relative grid grid-cols-2 border-t border-line sm:grid-cols-4">
          {live.map((c, i) => (
            <div
              key={c.label}
              className={`flex items-center gap-3 px-5 py-3 ${i > 0 ? "sm:border-l sm:border-line" : ""} ${i % 2 === 1 ? "border-l border-line" : ""} ${i > 1 ? "border-t border-line sm:border-t-0" : ""}`}
            >
              <span className={c.tone}>{c.icon}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">
                  {c.label}
                  <span className="rounded bg-sunk px-1 py-px text-[9.5px] tracking-normal">24h</span>
                </div>
                <div className={`font-mono text-[19px] font-bold leading-tight tabular-nums ${c.label === "Failed" && c.value > 0 ? "text-neg" : "text-fg"}`}>
                  {c.value}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {reportError && <p className="mt-3 text-[13px] font-medium text-neg">{reportError}</p>}

      {/* Tabs */}
      <div className="mt-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
              tab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-fg-3 hover:border-line-strong hover:text-fg"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line bg-paper p-0.5">
          {RANGES.map((r) => {
            const active = !customDates && range === r.key;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => pickRange(r.key)}
                className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
                  active ? "bg-accent text-white" : "text-fg-3 hover:bg-elev hover:text-fg"
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        <div
          className={`inline-flex flex-wrap items-center gap-2 rounded-lg border bg-paper px-2.5 py-1 ${
            customDates ? "border-accent ring-2 ring-accent-soft" : "border-line"
          }`}
        >
          <span className="text-fg-3">{Icons.calendar}</span>
          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3">
            From
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded border-0 bg-transparent px-1 py-1 font-mono text-[12.5px] font-normal tracking-normal text-fg outline-none"
            />
          </label>
          <span className="text-fg-4">→</span>
          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3">
            To
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded border-0 bg-transparent px-1 py-1 font-mono text-[12.5px] font-normal tracking-normal text-fg outline-none"
            />
          </label>
          {customDates && (
            <button
              type="button"
              onClick={() => {
                setFromDate("");
                setToDate("");
              }}
              className="rounded-md px-2 py-1 text-[12px] font-semibold text-accent hover:bg-accent-soft"
            >
              Clear
            </button>
          )}
        </div>

        {tab !== "overview" && (
          <label className="relative ml-auto w-full sm:w-[300px]">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3">{Icons.search}</span>
            <input
              type="search"
              placeholder={tab === "usage" ? "Search email, role, IP…" : "Search email, enquiry, tag, action, IP…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-line bg-paper py-2 pr-3 pl-9 text-[13px] text-fg outline-none transition placeholder:text-fg-4 focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
          </label>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--neg-soft)] bg-[var(--neg-soft)] px-4 py-3 text-[13px] font-medium text-neg">
          {Icons.alert} {error}
        </div>
      )}

      {!error && tab === "overview" && (
        <div className="mt-4">
          {isLoading || !overview ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-[112px] animate-pulse rounded-xl border border-line bg-paper" />
              ))}
              <div className="col-span-2 h-[300px] animate-pulse rounded-xl border border-line bg-paper lg:col-span-4" />
            </div>
          ) : (
            <AuditOverviewTab data={overview} windowLabel={windowLabel} />
          )}
        </div>
      )}

      {!error && tab !== "overview" && (
        <>
          <div className="mt-4 mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12.5px] text-fg-3">
              {!isLoading && (
                <>
                  <b className="font-mono text-fg">{total}</b>{" "}
                  {tab === "usage" ? `user${total === 1 ? "" : "s"} active` : `event${total === 1 ? "" : "s"}`} ·{" "}
                  {windowLabel}
                </>
              )}
            </div>
            {tab === "usage" && (
              <button
                type="button"
                onClick={() => setShowActiveHelp((v) => !v)}
                aria-expanded={showActiveHelp}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent hover:underline"
              >
                {Icons.info}
                {showActiveHelp ? "Hide explanation" : "How is Active Time calculated?"}
              </button>
            )}
          </div>

          {tab === "usage" && showActiveHelp && (
            <div className="mb-3 rounded-xl border border-[color-mix(in_srgb,var(--brand-blue)_25%,transparent)] bg-accent-soft px-5 py-4 text-[13px] leading-relaxed text-fg-2">
              <p>
                <strong className="text-fg">Active Time is estimated from activity, not from sign-in to sign-out.</strong>{" "}
                Sign-outs are almost never recorded — people close the browser tab — so session length can’t be measured directly.
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Every action a user takes (saving a step, generating a report, signing in…) is recorded with a time. Failed sign-ins are not counted.</li>
                <li>Those times are put in order and the gap between each one and the next is measured.</li>
                <li>
                  Gaps of <strong className="text-fg">15 minutes or less</strong> are added up as active time. A longer gap means they stepped away, so it counts as idle.
                </li>
              </ol>
              <p className="mt-2 rounded-lg bg-paper px-3 py-2 font-mono text-[12px]">
                Example: saves at 10:00, 10:04, 10:09 and then 11:30. The 4 and 5 minute gaps count (9 min); the 81 minute gap is idle. Active Time = 9m.
              </p>
              <p className="mt-2 text-[12px] text-fg-3">
                It’s a conservative figure: time spent reading or filling a form before the first save after a break isn’t visible to the audit trail.
              </p>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-line bg-paper">
            {isLoading && (
              <div className="p-4">
                <SkeletonRows rows={6} cols={6} />
              </div>
            )}

            {!isLoading && pageRows === 0 && (
              <EmptyState
                compact
                icon="search"
                title="Nothing recorded for this view"
                description="Activity is recorded from the moment auditing went live — older work won't appear. Try a wider date range."
              />
            )}

            {!isLoading && pageRows > 0 && (
              <div className="overflow-x-auto">
                {tab === "usage" ? (
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th className={TH}>User</th>
                        <th className={TH}>Role</th>
                        <th
                          className={TH}
                          title="Estimated from activity: gaps of 15 minutes or less between a user's actions are added up."
                        >
                          Active Time
                        </th>
                        <th className={`${TH} text-right`}>Actions</th>
                        <th className={`${TH} text-right`}>Sessions</th>
                        <th className={TH}>Last IP</th>
                        <th className={TH}>Last Active</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {usageRows.map((r) => (
                        <tr key={r.email ?? "unknown"} className="transition-colors hover:bg-elev">
                          <td className={TD}>
                            <UserCell email={r.email} />
                          </td>
                          <td className={TD}>
                            <RoleBadge role={r.role} />
                          </td>
                          <td className={`${TD} min-w-[170px]`}>
                            <div className="flex items-center gap-2.5">
                              <span className="w-[58px] shrink-0 font-mono font-semibold tabular-nums text-fg">
                                {formatDuration(r.activeSeconds)}
                              </span>
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunk">
                                <span
                                  className="block h-full rounded-full bg-gradient-to-r from-[var(--pos)] to-[var(--brand-cyan)]"
                                  style={{ width: `${(r.activeSeconds / maxActive) * 100}%` }}
                                />
                              </span>
                            </div>
                          </td>
                          <td className={`${TD} text-right font-mono tabular-nums`}>{r.actions}</td>
                          <td className={`${TD} text-right font-mono tabular-nums`}>{r.sessions}</td>
                          <td className={TD}>
                            <IpChip ip={r.lastIp} extra={r.ipCount > 1 ? r.ipCount - 1 : 0} />
                          </td>
                          <td className={`${TD} whitespace-nowrap`}>
                            <div className="font-mono text-[12.5px] text-fg">{fmtWhen(r.lastActive)}</div>
                            <div className="text-[11px] text-fg-3">{fmtAgo(r.lastActive)}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th className={TH}>When</th>
                        <th className={TH}>{tab === "access" ? "Changed By" : "User"}</th>
                        <th className={TH}>{tab === "access" ? "Change" : tab === "logins" ? "Event" : "Action"}</th>
                        {tab === "activity" && <th className={TH}>Enquiry / Tag</th>}
                        <th className={TH}>IP Address</th>
                        {tab === "logins" && <th className={TH}>Device</th>}
                        <th className={TH}>Detail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {eventRows.map((r) => {
                        const where = [r.enquiryCode, r.tagName].filter(Boolean).join(" · ");
                        const failed = r.eventType === "login_failed";
                        return (
                          <tr
                            key={r.id}
                            className={`transition-colors hover:bg-elev ${failed ? "bg-[color-mix(in_srgb,var(--neg)_5%,transparent)]" : ""}`}
                          >
                            <td className={`${TD} whitespace-nowrap`}>
                              <div className="font-mono text-[12.5px] text-fg">{fmtWhen(r.createdAt)}</div>
                              <div className="text-[11px] text-fg-3">{fmtAgo(r.createdAt)}</div>
                            </td>
                            <td className={`${TD} max-w-[260px]`}>
                              <UserCell email={r.email} role={r.role} />
                            </td>
                            <td className={TD}>
                              <ActionBadge action={r.action} eventType={r.eventType} />
                            </td>
                            {tab === "activity" && (
                              <td className={`${TD} max-w-[240px]`}>
                                {where ? (
                                  <>
                                    <div className="truncate font-mono text-[12px] font-semibold text-fg">{where}</div>
                                    {r.clientName && <div className="truncate text-[11.5px] text-fg-3">{r.clientName}</div>}
                                  </>
                                ) : (
                                  <span className="text-fg-4">—</span>
                                )}
                              </td>
                            )}
                            <td className={TD}>
                              <IpChip ip={r.ip} />
                            </td>
                            {tab === "logins" && (
                              <td className={TD}>
                                <DeviceCell ua={r.userAgent} />
                              </td>
                            )}
                            <td className={`${TD} min-w-[240px] text-[12.5px] leading-snug text-fg-2`}>
                              {r.detail ?? <span className="text-fg-4">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {!isLoading && (
              <div className="border-t border-line">
                <Pagination
                  page={page}
                  totalItems={total}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                  itemLabel={tab === "usage" ? "users" : "events"}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AuditLogPage;
