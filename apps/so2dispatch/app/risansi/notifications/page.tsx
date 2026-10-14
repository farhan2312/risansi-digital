import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Bug,
  CheckCircle2,
  Clock,
  OctagonAlert,
  PauseCircle,
  Pencil,
} from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { canSeeEscalations, departmentHrefForRole, canSeeClient } from "@/lib/roles";
import { ALERTS_PAGE_SIZE, listAlertsPage, type AlertRow } from "@/lib/alerts";
import {
  listNotificationsPage,
  recipientRolesForUser,
  type NotificationRow,
} from "@/lib/notifications";
import { pageResult, parsePage, type PageResult } from "@/lib/pagination";
import { MarkNotificationsSeen } from "@/components/risansi/mark-notifications-seen";
import { UrlPagination } from "@/components/risansi/url-table";

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

function NotificationFeed({
  page,
  hrefFor,
  commercial,
}: {
  page: PageResult<NotificationRow>;
  /** Show order and PI money on each notification (Billing and Accounts). */
  commercial: boolean;
  // Where "Open" should land — a department's own edit form, or the SO / EC
  // detail for central/admin (see the page component below).
  hrefFor: (n: NotificationRow) => string;
}) {
  const items = page.rows;
  if (page.total === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-surface px-6 py-16 text-center shadow-sm">
        <p className="text-sm font-medium text-foreground">No notifications yet</p>
        <p className="mt-1 text-sm text-muted">
          You&apos;ll be notified here as orders progress.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-surface shadow-sm">
      <ul className="divide-y divide-card-border">
        {items.map((n) => {
          const Icon = NOTIF_ICON[n.type] ?? Bell;
          const tone = NOTIF_TONE[n.type] ?? "bg-slate-100 text-slate-600";
          return (
            <li
              key={n.id}
              className="flex items-center justify-between gap-3 px-5 py-4"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{n.message}</p>
                  {commercial && <CommercialDetails n={n} />}
                  <p className="mt-1 text-xs text-muted">{timeAgo(n.created_at)}</p>
                </div>
              </div>
              {(n.order_id || n.bug_report_id) && (
                <Link
                  href={hrefFor(n)}
                  className="shrink-0 text-sm font-medium text-primary hover:text-primary-hover"
                >
                  Open
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <UrlPagination
        paramKey="npage"
        page={page.page}
        totalPages={page.totalPages}
        from={page.from}
        to={page.to}
        total={page.total}
      />
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
  const [notifications, alerts] = await Promise.all([
    listNotificationsPage(
      recipientRolesForUser(user.role),
      parsePage(params.npage),
      user.id,
      user.role === "rep" ? user.rep_name?.trim() || "(no rep linked)" : null
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

      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Bell className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {oversight ? "Notifications & Escalations" : "Notifications"}
          </h1>
          <p className="text-sm text-muted">
            {oversight
              ? "Updates on your orders, plus overdue steps, LD risks and payment holds across all orders."
              : "Updates on the orders your department works on."}
          </p>
        </div>
      </div>

      <NotificationFeed
        page={notifications}
        hrefFor={hrefFor}
        commercial={COMMERCIAL_ROLES.has(user.role)}
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
