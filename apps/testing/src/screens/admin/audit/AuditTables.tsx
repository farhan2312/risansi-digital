"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { getAuditActivity, getAuditSessions, getAuditUsage, getAuditUserPages } from "@/services/adminService";
import Pagination from "@/components/ui/Pagination";
import { SkeletonTableRows } from "@/components/ui/Skeleton";
import { avatarColor } from "@/lib/avatar";
import { formatDuration, personInitials, ROLE_LABELS } from "./auditFormat";
import type {
  AuditActivityEntry,
  AuditRange,
  AuditSessionEntry,
  AuditUsageRow,
  AuditUserPageRow,
} from "@/types/testing";

const PAGE_SIZE = 25;

// ---------------------------------------------------------------- shared bits

const EVENT_BADGES: Record<string, { label: string; icon: string; className: string }> = {
  login: { label: "Sign-in", icon: "→", className: "bg-pos-soft text-pos-strong" },
  login_failed: { label: "Failed sign-in", icon: "✕", className: "bg-neg-soft text-neg-strong" },
  logout: { label: "Sign-out", icon: "←", className: "bg-bg-sunk text-text-muted" },
  create: { label: "Created", icon: "＋", className: "bg-info-soft text-info" },
  update: { label: "Updated", icon: "✎", className: "bg-warn-soft text-warn" },
  delete: { label: "Deleted", icon: "🗑", className: "bg-neg-soft text-neg-strong" },
};

const EventBadge = ({ type }: { type: string }) => {
  const badge = EVENT_BADGES[type] ?? { label: type, icon: "•", className: "bg-bg-sunk text-text-muted" };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
      <span aria-hidden="true">{badge.icon}</span>
      {badge.label}
    </span>
  );
};

const RolePill = ({ role }: { role: string | null }) =>
  role ? (
    <span className="ml-2 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
      {ROLE_LABELS[role] ?? role}
    </span>
  ) : null;

const Person = ({ email, name }: { email: string | null; name: string | null }) => (
  <div className="flex min-w-0 items-center gap-2.5">
    <span
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={{ background: avatarColor(email ?? name ?? "?") }}
      aria-hidden="true"
    >
      {personInitials(name, email)}
    </span>
    <span className="truncate text-[13px] font-medium text-text-h">{email ?? name ?? "—"}</span>
  </div>
);

const TableShell = ({ head, children, footer }: { head: string[]; children: ReactNode; footer?: ReactNode }) => (
  <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-bg-sunk text-left text-[11px] uppercase tracking-wide text-text-muted">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
    {footer}
  </div>
);

const EmptyRow = ({ columns, text }: { columns: number; text: string }) => (
  <tr>
    <td colSpan={columns} className="px-4 py-10 text-center text-sm text-text-muted">
      {text}
    </td>
  </tr>
);

const ErrorText = ({ text }: { text: string }) => <p className="text-sm font-medium text-neg">{text}</p>;

const cell = "px-4 py-3 align-middle";
const rowClass = "border-t border-border transition-colors hover:bg-surface-hover";
const timeText = (iso: string) => new Date(iso).toLocaleString();

// ---------------------------------------------------------------- Usage by User

export const UsageTab = ({ range }: { range: AuditRange }) => {
  const [rows, setRows] = useState<AuditUsageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pages, setPages] = useState<Record<string, AuditUserPageRow[]>>({});
  const [pagesLoading, setPagesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    setExpanded(null);
    setPages({});
    getAuditUsage(range)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setError("Could not load usage."))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (userId: string) => {
    if (expanded === userId) return setExpanded(null);
    setExpanded(userId);
    if (!pages[userId]) {
      setPagesLoading(true);
      getAuditUserPages(userId, range)
        .then((r) => setPages((prev) => ({ ...prev, [userId]: r })))
        .catch(() => setPages((prev) => ({ ...prev, [userId]: [] })))
        .finally(() => setPagesLoading(false));
    }
  };

  const totalActive = rows.reduce((sum, r) => sum + r.active_seconds, 0);

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorText text={error} />}
      {!isLoading && !error && (
        <p className="text-[13px] text-text-muted">
          {rows.length} user{rows.length === 1 ? "" : "s"} active · {formatDuration(totalActive)} total active time · click a user for the page breakdown
        </p>
      )}
      <TableShell head={["User", "Role", "Active time", "Sessions", "Last active"]}>
        {isLoading ? (
          <SkeletonTableRows columns={5} />
        ) : rows.length === 0 ? (
          <EmptyRow columns={5} text="No activity in this range." />
        ) : (
          rows.map((r) => (
            <Fragment key={r.user_id}>
              <tr className={`${rowClass} cursor-pointer`} onClick={() => toggle(r.user_id)}>
                <td className={cell}>
                  <div className="flex items-center gap-2">
                    <span className="w-3 text-center text-text-faint" aria-hidden="true">
                      {expanded === r.user_id ? "−" : "+"}
                    </span>
                    <Person email={r.user_email} name={r.user_name} />
                  </div>
                </td>
                <td className={cell}>
                  {r.user_role ? (
                    <span className="rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">
                      {ROLE_LABELS[r.user_role] ?? r.user_role}
                    </span>
                  ) : (
                    <span className="text-text-faint">Removed</span>
                  )}
                </td>
                <td className={`${cell} font-semibold text-text-h`} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatDuration(r.active_seconds)}
                </td>
                <td className={cell}>{r.session_count}</td>
                <td className={`${cell} whitespace-nowrap text-text-muted`}>{timeText(r.last_active)}</td>
              </tr>
              {expanded === r.user_id && (
                <tr className="bg-bg-sunk/50">
                  <td colSpan={5} className="px-4 py-3">
                    {pagesLoading && !pages[r.user_id] ? (
                      <p className="text-[13px] text-text-muted">Loading page breakdown…</p>
                    ) : (pages[r.user_id]?.length ?? 0) === 0 ? (
                      <p className="text-[13px] text-text-muted">No individual page views recorded in this range.</p>
                    ) : (
                      <table className="w-full max-w-2xl border-collapse text-[13px]">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted">
                            <th className="pb-1.5 font-semibold">Page</th>
                            <th className="pb-1.5 font-semibold">Views</th>
                            <th className="pb-1.5 font-semibold">Last visited</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pages[r.user_id]!.map((p) => (
                            <tr key={p.path} className="border-t border-border">
                              <td className="py-1.5 pr-4">
                                <code className="text-xs text-text-h">{p.path}</code>
                              </td>
                              <td className="py-1.5 pr-4" style={{ fontVariantNumeric: "tabular-nums" }}>
                                {p.view_count}
                              </td>
                              <td className="py-1.5 text-text-muted">{timeText(p.last_viewed)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))
        )}
      </TableShell>
    </div>
  );
};

// ---------------------------------------------------------------- Logins & Sessions

export const SessionsTab = ({ range }: { range: AuditRange }) => {
  const [rows, setRows] = useState<AuditSessionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => setPage(1), [range.from, range.to]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    getAuditSessions(range, page)
      .then((r) => {
        if (cancelled) return;
        setRows(r.entries);
        setTotal(r.total);
      })
      .catch(() => !cancelled && setError("Could not load sign-in activity."))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, page]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorText text={error} />}
      <TableShell
        head={["Event", "User", "Details", "IP address", "When"]}
        footer={<Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
      >
        {isLoading ? (
          <SkeletonTableRows columns={5} />
        ) : rows.length === 0 ? (
          <EmptyRow columns={5} text="No sign-in activity in this range." />
        ) : (
          rows.map((s) => (
            <tr key={s.id} className={rowClass}>
              <td className={cell}>
                <EventBadge type={s.event_type} />
              </td>
              <td className={cell}>
                <Person email={s.user_email} name={s.user_name} />
              </td>
              <td className={`${cell} text-text-muted`}>{s.details ?? "—"}</td>
              <td className={cell}>{s.ip_address ? <code className="rounded-md bg-bg-sunk px-2 py-0.5 text-xs">{s.ip_address}</code> : <span className="text-text-faint">—</span>}</td>
              <td className={`${cell} whitespace-nowrap text-text-muted`}>{timeText(s.created_at)}</td>
            </tr>
          ))
        )}
      </TableShell>
    </div>
  );
};

// ---------------------------------------------------------------- Activity + Access Changes

/** Only requisitions and reports have their own detail page to link to.
 * Prefers the pretty number (REQ-…/TR-…); the raw uuid still resolves through
 * the lookup's backward-compat match when the row has since been deleted. */
const entityHref = (entityType: string | null, entityId: string | null, entityNo: string | null): string | null => {
  if (!entityId) return null;
  if (entityType === "requisition") return `/requisitions/${entityNo ?? entityId}`;
  if (entityType === "report") return `/reports/${entityNo ?? entityId}`;
  return null;
};

type ActionFilter = "all" | "create" | "update" | "delete";

export const ActivityTab = ({ range, entity }: { range: AuditRange; entity?: "user" }) => {
  const [rows, setRows] = useState<AuditActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<ActionFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => setPage(1), [range.from, range.to, search, action]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    getAuditActivity(range, page, {
      search: search || undefined,
      action: action === "all" ? undefined : action,
      entity,
    })
      .then((r) => {
        if (cancelled) return;
        setRows(r.entries);
        setTotal(r.total);
      })
      .catch(() => !cancelled && setError("Could not load activity."))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, page, search, action, entity]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder={entity === "user" ? "Search person, account, detail…" : "Search user, entity, action…"}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setSearch(searchInput.trim())}
          className="min-w-[240px] flex-1 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-text outline-none focus:border-accent"
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as ActionFilter)}
          className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-text outline-none focus:border-accent"
          aria-label="Action type"
        >
          <option value="all">All actions</option>
          <option value="create">Created</option>
          <option value="update">Updated</option>
          <option value="delete">Deleted</option>
        </select>
        <button
          type="button"
          onClick={() => setSearch(searchInput.trim())}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover"
        >
          Search
        </button>
      </div>

      {error && <ErrorText text={error} />}
      {!isLoading && !error && <p className="text-[13px] text-text-muted">{total.toLocaleString()} entries · newest first</p>}

      <TableShell
        head={["When", "Actor", "Action", "Entity", "What", "IP"]}
        footer={<Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
      >
        {isLoading ? (
          <SkeletonTableRows columns={6} />
        ) : rows.length === 0 ? (
          <EmptyRow columns={6} text={entity === "user" ? "No account changes match this filter." : "No data changes match this filter."} />
        ) : (
          rows.map((a) => {
            // A deleted item has no page left to open, so its row is plain text.
            const href = a.event_type === "delete" ? null : entityHref(a.entity_type, a.entity_id, a.entity_no);
            const typeLabel = a.entity_type ? a.entity_type.replace("_", " ").replace(/^./, (c) => c.toUpperCase()) : null;
            const entityText = typeLabel ? `${typeLabel}${a.entity_label ? ` · ${a.entity_label}` : ""}` : "—";
            return (
              <tr key={a.id} className={rowClass}>
                <td className={`${cell} whitespace-nowrap text-text-muted`}>{timeText(a.created_at)}</td>
                <td className={cell}>
                  <div className="flex items-center">
                    <Person email={a.user_email} name={a.user_name} />
                    <RolePill role={a.user_role} />
                  </div>
                </td>
                <td className={cell}>
                  <EventBadge type={a.event_type} />
                </td>
                <td className={cell}>
                  {href ? (
                    <Link href={href} className="font-medium text-accent hover:underline">
                      {entityText}
                    </Link>
                  ) : (
                    entityText
                  )}
                </td>
                <td className={`${cell} max-w-[320px] text-text-muted`}>{a.details ?? "—"}</td>
                <td className={cell}>{a.ip_address ? <code className="rounded-md bg-bg-sunk px-2 py-0.5 text-xs">{a.ip_address}</code> : <span className="text-text-faint">—</span>}</td>
              </tr>
            );
          })
        )}
      </TableShell>
    </div>
  );
};
