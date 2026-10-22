import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import {
  canEditChild,
  canViewDepartment,
  isRep,
  reminderDeptForTable,
} from "@/lib/roles";
import {
  listItemsForPurchasePage,
  parseQueueSort,
  resolveFocusOrderId,
  listDeptCompletions,
  listOrderListOptions,
} from "@/lib/orders";
import { parsePage, parseQuery } from "@/lib/pagination";
import { parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { listRemindersForDepartment } from "@/lib/reminders";
import { unreadByOrder } from "@/lib/order-messages";
import { PurchaseWorkspace } from "@/components/risansi/purchase-workspace";
import { countEcDocuments } from "@/lib/drawing-docs-db";
import { RemindersPanel } from "@/components/risansi/reminders-panel";
import { deptKpiCards, listBoiVendors } from "@/lib/orders";
import { DEPT_VIEWS } from "@/lib/dept-view";
import { toneFor, type KpiCardDef } from "@/lib/kpis";
import {
  BOI_STATUSES,
  PURCHASE_STATES,
  boiCountSql,
  boiMatches,
  ecCountSql,
  ecMatchesPurchaseFilter,
  ecPurchaseState,
  parsePurchaseFilter,
  purchaseFilterActive,
  purchaseFilterSql,
  soPurchaseState,
  soPurchaseStateSql,
} from "@/lib/purchase-filter";

export const metadata: Metadata = {
  title: "Purchase | Risansi",
};

export const dynamic = "force-dynamic";

const TABLE = "order_purchase" as const;

export default async function PurchaseWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewDepartment(user.role, TABLE)) redirect("/risansi/dashboard");

  const params = await searchParams;
  const { edit, thread, page, q } = params;
  // This department's own filter bar, with the department pinned.
  // A Rep sees only their own SOs.
  const filter = scopeToRep(parseDeptFilter((key) => params[key], "purchase"), user);
  // A notification links to an EC (item id) or an SO; open the page that holds it.
  // Which SO a notification link should open on. Without a link this is
  // immediate; everything else below loads side by side.
  // A reminder (?focus=) lands on its SO in this queue, like a notification.
  const focusOrderId = await resolveFocusOrderId(params.focus ?? thread ?? edit);
  // Purchase's own filters: the SO's and each EC's Open / Closed / N/A, each
  // bought-out item's status, and its vendor.
  const purchaseFilter = parsePurchaseFilter((key) => params[key]);
  const none = { so: [] as string[], ec: [] as string[], item: [] as string[], boi: [] as string[], vendor: [] as string[] };
  // The cards: SOs, ECs and bought-out items, each by where it stands — the
  // EC and item cards count ECs and items, and filter like the rest. They
  // follow the BOI item and Vendor filters.
  const purchaseKpiCards = (): KpiCardDef[] => {
    const clear = { pur_so: null, pur_ec: null, pur_boi: null, overdue: null, dstatus: null } as Record<string, string | null>;
    const overdue = deptKpiCards("purchase", [], DEPT_VIEWS.purchase.hasTarget).find((c) => c.key === "overdue");
    const tone = (st: string) => (st === "Closed" ? ("done" as const) : st === "Open" ? ("pending" as const) : ("neutral" as const));
    return [
      { key: "all", label: "All SOs", group: "SO", sql: null, params: { ...clear }, tone: "neutral" },
      ...PURCHASE_STATES.map((st) => ({
        key: `so:${st}`,
        label: `SO ${st}`,
        group: "SO",
        sql: `${soPurchaseStateSql("o")} = '${st}'`,
        params: { ...clear, pur_so: st },
        tone: tone(st),
      })),
      ...(overdue ? [{ ...overdue, group: "SO", params: { ...clear, overdue: "1" } }] : []),
      { key: "ecs", label: "ECs", group: "EC", sql: null, params: {}, tone: "neutral", measure: ecCountSql("o") },
      ...PURCHASE_STATES.map((st) => ({
        key: `ec:${st}`,
        label: `EC ${st}`,
        group: "EC",
        sql: null,
        params: { ...clear, pur_ec: st },
        tone: tone(st),
        measure: ecCountSql("o", st),
      })),
      { key: "boi", label: "BOI items", group: "BOI", sql: null, params: {}, tone: "neutral", measure: boiCountSql("o", null, purchaseFilter.vendor, purchaseFilter.item) },
      ...BOI_STATUSES.map((st) => ({
        key: `boi:${st}`,
        label: st,
        group: "BOI",
        sql: null,
        params: { ...clear, pur_boi: st },
        tone: toneFor(st),
        measure: boiCountSql("o", st, purchaseFilter.vendor, purchaseFilter.item),
      })),
    ];
  };
  const [queue, reminders, filterOptions, vendors] = await Promise.all([
    listItemsForPurchasePage({
      kpis: purchaseKpiCards(),
      extraRestrict: purchaseFilterSql(purchaseFilter),
      kpiRestrict: purchaseFilterSql({ ...none, vendor: purchaseFilter.vendor, item: purchaseFilter.item }),
      page: parsePage(page),
      search: parseQuery(q),
      focusOrderId,
      sort: parseQueueSort(params.sort),
      filter,
    }),
    isRep(user.role) ? Promise.resolve([]) : listRemindersForDepartment(reminderDeptForTable(TABLE)!),
    listOrderListOptions(filter),
    listBoiVendors(),
  ]);

  // Each SO's and EC's state from all its items — worked out before a filter
  // narrows what is shown. Then only the ECs, and their items, that match.
  {
    const byOrder = new Map<string, typeof queue.rows>();
    for (const r of queue.rows) byOrder.set(String(r.order_id), [...(byOrder.get(String(r.order_id)) ?? []), r]);
    for (const [, ecs] of byOrder) {
      const pumps = ecs.filter((r) => String(r.item_type ?? "").trim().toLowerCase() !== "spare");
      const so = soPurchaseState(pumps);
      for (const r of ecs) Object.assign(r, { pur_so_state: so, pur_ec_state: ecPurchaseState(r) });
    }
  }
  if (purchaseFilterActive(purchaseFilter)) {
    queue.rows = queue.rows.filter((r) => ecMatchesPurchaseFilter(r, purchaseFilter));
    if (purchaseFilter.item.length || purchaseFilter.boi.length || purchaseFilter.vendor.length) {
      for (const r of queue.rows) {
        r.boi_items = ((r.boi_items ?? []) as Record<string, unknown>[]).filter((b) => boiMatches(b, purchaseFilter));
      }
    }
  }

  // Unread discussion messages per SO, for the row badge.
  // Purchase's sign-offs for the SOs on this page, for the EC cards.
  // The rows' sign-offs, unread messages and drawing documents all hang off
  // the queue and not off one another, so they load together.
  const [completions, unreadThreads, drawingDocCounts] = await Promise.all([
    listDeptCompletions([...new Set(queue.rows.map((o) => String(o.order_id ?? o.id)))]),
    unreadByOrder([...new Set(queue.rows.map((r) => String(r.order_id)))], user),
    // Drawing documents shared with Purchase, per EC, for the button badge.
    countEcDocuments(queue.rows.map((r) => String(r.id)), user.role),
  ]);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Package className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Purchase
          </h1>
          <p className="text-sm text-muted">
            Add bought-out (BOI) items per EC. Orders with BOI = No are
            excluded — Purchase has nothing to do for those. BOI and the
            purchase target date are set by Central Visibility.
          </p>
        </div>
      </div>

      <RemindersPanel reminders={reminders} focusInQueue />

      <PurchaseWorkspace
        completions={completions}
        openThreadId={thread}
        focusOrderId={focusOrderId ?? undefined}
        role={user.role}
        unreadThreads={unreadThreads}
        queue={queue}
        kpis={queue.kpis}
        filterOptions={filterOptions}
        vendors={vendors}
        canEdit={canEditChild(user.role, "order_boi_items")}
        openItemId={edit}
        drawingDocCounts={drawingDocCounts}
      />
    </div>
  );
}
