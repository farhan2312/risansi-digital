import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Inbox,
  Bug,
  CheckCircle2,
  Clock,
  OctagonAlert,
  PauseCircle,
  Pencil,
} from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { canSeeEscalations, departmentHrefForRole, canSeeClient, isRep } from "@/lib/roles";
import { ALERTS_PAGE_SIZE, listAlertsPage, type AlertRow } from "@/lib/alerts";
import {
  listNotificationsPage,
  recipientRolesForUser,
  type NotificationRow,
} from "@/lib/notifications";
import { pageResult, parsePage, type PageResult } from "@/lib/pagination";
import { MarkNotificationsSeen } from "@/components/risansi/mark-notifications-seen";
import { UrlPagination } from "@/components/risansi/url-table";
import { NotificationRangeToggle, type NotificationRange } from "@/components/risansi/notification-range";

export const metadata: Metadata = {
  title: "Notifications | Risansi",
};

export const dynamic = "force-dynamic";

// ---------- event feed ----------

const NOTIF_ICON = {
  payment_terms: PauseCircle,
  target_date: Clock,
  dept_complete: CheckCircle2,
  dept_update: Pencil,
  bug_status: Bug,
} as const;

const NOTIF_TONE = {
  payment_terms: "bg-amber-50 text-amber-600",
  target_date: "bg-blue-50 text-blue-600",
  dept_complete: "bg-emerald-50 text-emerald-600",
  dept_update: "bg-slate-100 text-slate-600",
  bug_status: "bg-rose-50 text-rose-600",
} as const;

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

const amountFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** "12,34,567 INR", or null when there is no amount to show. */
function money(value: string | null, currency: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  const text = Number.isFinite(n) ? amountFmt.format(n) : value;
  return currency ? `${text} ${currency}` : text;
}

/**
 * Billing and Accounts work in money: their notifications carry the order's
 * SO No., client and value, and the PI — the one the notification is about,
 * or else the order's PIs so far with their total.
 */
function CommercialDetails({ n }: { n: NotificationRow }) {
  if (!n.order_id) return null;
  // Line one names the order; line two is its money — so every notification
  // reads the same way, however long the client's name.
  const order: { label: string; value: string }[] = [
    { label: "SO No.", value: n.so_no ?? "—" },
    { label: "Client", value: n.client_name ?? "—" },
  ];
  const amounts: { label: string; value: string }[] = [
    { label: "Order value", value: money(n.order_value, n.order_currency) ?? "—" },
  ];
  if (n.pi_no) {
    amounts.push({ label: "PI No.", value: n.pi_no });
    amounts.push({ label: "PI amount", value: money(n.pi_value, n.order_currency) ?? "—" });
  } else if (n.order_pi_count > 0) {
    const one = n.order_pi_count === 1;
    amounts.push({ label: one ? "PI No." : "PI Nos.", value: n.order_pi_nos ?? "—" });
    amounts.push({
      label: one ? "PI amount" : "PI total",
      value: money(n.order_pi_total, n.order_currency) ?? "—",
    });
  } else {
    amounts.push({ label: "PI", value: "none yet" });
  }
  const line = (items: { label: string; value: string }[]) => (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5">
      {items.map((i) => (
        <div key={i.label} className="flex min-w-0 items-baseline gap-1.5">
          <dt className="shrink-0 text-muted">{i.label}</dt>
          <dd className="min-w-0 break-words font-medium text-foreground">{i.value}</dd>
        </div>
      ))}
    </div>
  );
  return (
    <dl className="mt-1.5 space-y-0.5 text-xs">
      {line(order)}
      {line(amounts)}
    </dl>
  );
}

const NOTIF_LABEL = {
  payment_terms: "Payment",
  target_date: "Target date",
  dept_complete: "Completed",
  dept_update: "Update",
  bug_status: "Bug report",
} as const;

/** "2026-10-21" in India, for grouping by day. */
function istDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Today, Yesterday, or "Mon, 19 Oct". */
function dayHeading(day: string): string {
  const today = istDay(new Date().toISOString());
  const yesterday = istDay(new Date(Date.now() - 86400000).toISOString());
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

function NotificationFeed({
  page,
  hrefFor,
  commercial,
  seenAt,
  rangeLabel,
}: {
  page: PageResult<NotificationRow>;
  /** Show order and PI money on each notification (Billing and Accounts). */
  commercial: boolean;
  // Where "Open" should land — a department's own edit form, or the SO / EC
  // detail for central/admin (see the page component below).
  hrefFor: (n: NotificationRow) => string;
  /** When the reader last looked: anything after it is New. */
  seenAt: string | null;
  /** "in the last 3 days", for the empty state. */
  rangeLabel: string;
}) {
  const items = page.rows;
  if (page.total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-card-border bg-surface px-6 py-16 text-center">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Inbox className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold text-foreground">Nothing {rangeLabel}</p>
        <p className="mt-1 text-sm text-muted">You&apos;ll be notified here as orders progress.</p>
      </div>
    );
  }
  const seen = seenAt ? new Date(seenAt).getTime() : null;
  // Newest first, under one heading per day.
  const days: { day: string; rows: NotificationRow[] }[] = [];
  for (const n of items) {
    const d = istDay(n.created_at);
    const last = days[days.length - 1];
    if (last && last.day === d) last.rows.push(n);
    else days.push({ day: d, rows: [n] });
  }
  return (
    <div className="space-y-6">
      {days.map(({ day, rows }) => (
        <section key={day}>
          <h3 className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {dayHeading(day)}
            <span className="h-px flex-1 bg-card-border" />
            <span className="font-medium normal-case tracking-normal text-muted">{rows.length}</span>
          </h3>
          <ul className="space-y-2">
            {rows.map((n) => {
              const Icon = NOTIF_ICON[n.type] ?? Bell;
              const tone = NOTIF_TONE[n.type] ?? "bg-slate-100 text-slate-600";
              const fresh = seen !== null && new Date(n.created_at).getTime() > seen;
              const href = n.order_id || n.bug_report_id ? hrefFor(n) : null;
              return (
                <li
                  key={n.id}
                  className={`group relative flex items-start gap-3 overflow-hidden rounded-xl border bg-surface px-4 py-3.5 shadow-sm transition-colors ${
                    fresh ? "border-primary/40 bg-primary/[0.03]" : "border-card-border hover:border-primary/30"
                  }`}
                >
                  {fresh && <span className="absolute bottom-3 left-0 top-3 w-1 rounded-r-full bg-primary" aria-hidden />}
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${tone}`}>{NOTIF_LABEL[n.type] ?? "Update"}</span>
                      {n.so_no && (
                        <span className="rounded-full bg-background px-2 py-0.5 text-[10.5px] font-semibold text-foreground ring-1 ring-inset ring-card-border">
                          {n.so_no}
                        </span>
                      )}
                      {n.ec_no && (
                        <span className="rounded-full bg-background px-2 py-0.5 text-[10.5px] font-medium text-muted ring-1 ring-inset ring-card-border">
                          EC {n.ec_no}
                        </span>
                      )}
                      {fresh && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">New</span>
                      )}
                    </div>
                    <p className="text-sm font-medium leading-snug text-foreground">{n.message}</p>
                    {commercial && <CommercialDetails n={n} />}
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-muted">
                      <Clock className="h-3 w-3" />
                      {clockTime(n.created_at)} · {timeAgo(n.created_at)}
                    </p>
                  </div>
                  {href && (
                    <Link
                      href={href}
                      className="inline-flex shrink-0 items-center gap-1 self-center rounded-lg border border-input-border px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
                    >
                      Open
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div className="overflow-hidden rounded-xl border border-card-border bg-surface shadow-sm">
        <UrlPagination paramKey="npage" page={page.page} totalPages={page.totalPages} from={page.from} to={page.to} total={page.total} />
      </div>
    </div>
  );
}

// ---------- escalations (oversight only) ----------

type Severity = "escalation" | "serious" | "warning";

function severityOf(alert: AlertRow): Severity {
  if (alert.type === "hold") return "escalation";
  if (alert.type === "ld_risk") return "serious";
  return (alert.days_overdue ?? 0) >= 7 ? "serious" : "warning";
}

function messageOf(alert: AlertRow): string {
  if (alert.type === "hold") return "Payment on hold — escalated to Central Visibility";
  const days = alert.days_overdue ?? 0;
  if (alert.type === "ld_risk") return `Quality docs overdue by ${days} day(s) — LD risk`;
  return `${alert.department} overdue by ${days} day(s)`;
}

const SEVERITY_STYLES: Record<
  Severity,
  { icon: typeof AlertTriangle; chip: string }
> = {
  escalation: { icon: PauseCircle, chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  serious: { icon: OctagonAlert, chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  warning: { icon: AlertTriangle, chip: "bg-amber-50 text-amber-700 ring-amber-200" },
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Per-EC escalations open that EC's summary; SO-level ones (payment holds)
// open the SO.
function alertHref(alert: AlertRow): string {
  return alert.item_id
    ? `/risansi/orders/${alert.id}/items/${alert.item_id}`
    : `/risansi/orders/${alert.id}`;
}

function Escalations({
  page,
  showClient = true,
}: {
  page: PageResult<AlertRow>;
  showClient?: boolean;
}) {
  const alerts = page.rows;
  if (page.total === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-surface px-6 py-12 text-center shadow-sm">
        <p className="text-sm font-medium text-foreground">All clear</p>
        <p className="mt-1 text-sm text-muted">
          No overdue steps, LD risks or payment holds right now.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-surface shadow-sm">
      <ul className="divide-y divide-card-border">
        {alerts.map((alert, i) => {
          const style = SEVERITY_STYLES[severityOf(alert)];
          const Icon = style.icon;
          return (
            <li
              key={`${alert.id}-${alert.item_id ?? ""}-${alert.department}-${i}`}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.chip}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {alert.department}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {messageOf(alert)}
                  </p>
                  <p className="truncate text-xs text-muted">
                    #{alert.sl_no} · {alert.so_no ?? "—"}
                    {alert.ec_no ? ` · ${alert.ec_no}` : ""}
                    {showClient && alert.client_name ? ` · ${alert.client_name}` : ""}
                    {alert.due_date ? ` · due ${formatDate(alert.due_date)}` : ""}
                  </p>
                </div>
              </div>
              <Link
                href={alertHref(alert)}
                className="shrink-0 text-sm font-medium text-primary hover:text-primary-hover"
              >
                Open
              </Link>
            </li>
          );
        })}
      </ul>
      <UrlPagination
        paramKey="epage"
        page={page.page}
        totalPages={page.totalPages}
        from={page.from}
        to={page.to}
        total={page.total}
      />
    </div>
  );
}

// ---------- page ----------

/** Billing & Operations and Accounts: the departments that work in money. */
const COMMERCIAL_ROLES = new Set(["operations", "accounts"]);

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Two lists, each paging on its own param (25 a page).
  const params = await searchParams;
  const oversight = canSeeEscalations(user.role);
  // How far back: a department starts on the last 3 days, oversight on all time.
  const fallback: NotificationRange = oversight ? "all" : "3d";
  const range: NotificationRange = (["3d", "7d", "all"] as const).find((r) => r === params.range) ?? fallback;
  const sinceDays = range === "3d" ? 3 : range === "7d" ? 7 : null;
  const rangeLabel = range === "3d" ? "in the last 3 days" : range === "7d" ? "in the last 7 days" : "yet";
  const [notifications, alerts] = await Promise.all([
    listNotificationsPage(
      recipientRolesForUser(user.role),
      parsePage(params.npage),
      user.id,
      isRep(user.role) ? (user.rep_names?.length ? user.rep_names : ["(no rep linked)"]) : null,
      sinceDays
    ),
    oversight
      ? listAlertsPage(parsePage(params.epage))
      : Promise.resolve(pageResult<AlertRow>([], 0, 1, ALERTS_PAGE_SIZE)),
  ]);

  // Departments open straight into their own workspace, deep-linked to the EC
  // row (item_id) when the event is per-EC; central/admin open the EC detail
  // when known, else the SO.
  const deptHref = departmentHrefForRole(user.role);
  const hrefFor = (n: NotificationRow) => {
    // A bug report's news opens the tracker at that report.
    if (n.bug_report_id) return `/risansi/bug-reports?report=${n.bug_report_id}`;
    if (deptHref) return `${deptHref}?edit=${n.item_id ?? n.order_id}`;
    if (n.item_id && n.order_id) {
      return `/risansi/orders/${n.order_id}/items/${n.item_id}`;
    }
    return `/risansi/orders/${n.order_id}`;
  };

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <MarkNotificationsSeen />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Bell className="h-6 w-6" />
        </div>
        <div className="mr-auto">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {oversight ? "Notifications & Escalations" : "Notifications"}
          </h1>
          <p className="text-sm text-muted">
            {oversight
              ? "Updates on your orders, plus overdue steps, LD risks and payment holds across all orders."
              : "Updates on the orders your department works on."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">
            <span className="font-semibold text-foreground">{notifications.total}</span> {range === "all" ? "in all" : rangeLabel}
          </span>
          <NotificationRangeToggle value={range} fallback={fallback} />
        </div>
      </div>

      <NotificationFeed
        page={notifications}
        hrefFor={hrefFor}
        commercial={COMMERCIAL_ROLES.has(user.role)}
        seenAt={user.notifications_seen_at ?? null}
        rangeLabel={rangeLabel}
      />

      {oversight && (
        <>
          <h2 className="mb-3 mt-8 font-display text-base font-semibold text-foreground">
            Escalations — {alerts.total} active
          </h2>
          <Escalations page={alerts} showClient={canSeeClient(user.role)} />
        </>
      )}
    </div>
  );
}
