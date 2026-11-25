import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { VIEW_MODE_COOKIE, viewModeOf } from "@/lib/view-mode";
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
import { parsePendencyFilter } from "@/lib/pendency";
import { listPendency, pendencyFilterSql } from "@/lib/pendency-db";
import { listRemindersForDepartment } from "@/lib/reminders";
import { unreadByOrder } from "@/lib/order-messages";
import { PurchaseWorkspace } from "@/components/risansi/purchase-workspace";
import { countEcDocuments } from "@/lib/drawing-docs-db";
import { RemindersPanel } from "@/components/risansi/reminders-panel";
import { listBoiVendors, listVendorList } from "@/lib/orders";
import { cardBaseGet, type KpiCardDef } from "@/lib/kpis";
import {
  boiMatches,
  ecMatchesPurchaseFilter,
  ecPurchaseState,
  parsePurchaseFilter,
  purchaseFilterActive,
  purchaseFilterSql,
  soPurchaseState,
} from "@/lib/purchase-filter";
import { purchaseCards } from "@/lib/dept-cards";
import { withoutClient } from "@/lib/client-visibility";
import { homeFor, mayOpenPage } from "@/lib/view-pages";
import { PageHeading } from "@/components/risansi/page-heading";

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
  // 360° View: only the pages picked for them.
  if (!mayOpenPage(user, "/risansi/departments/purchase")) redirect(homeFor(user));

  const params = await searchParams;
  const { edit, thread, page, q } = params;
  // This department's own filter bar, with the department pinned.
  // A Rep sees only their own SOs.
  const filter = scopeToRep(parseDeptFilter((key) => params[key], "purchase"), user);
  // The cards count over the filter bar as set, less the card clicked.
  const cardGet = cardBaseGet((key) => params[key]);
  filter.kpiFilter = parseDeptFilter(cardGet, "purchase");
  // A notification links to an EC (item id) or an SO; open the page that holds it.
  // Which SO a notification link should open on. Without a link this is
  // immediate; everything else below loads side by side.
  // A reminder (?focus=) lands on its SO in this queue, like a notification.
  const focusOrderId = await resolveFocusOrderId(params.focus ?? thread ?? edit);
  // Purchase's own filters: the SO's and each EC's Open / Closed / N/A, each
  // bought-out item's status, and its vendor.
  const purchaseFilter = parsePurchaseFilter((key) => params[key]);
  // The cards: SOs, ECs and bought-out items, each by where it stands — the
  // EC and item cards count ECs and items, and filter like the rest. They
  // follow the BOI item and Vendor filters.
  const purchaseKpiCards = (): KpiCardDef[] => purchaseCards(purchaseFilter);
  const [queue, reminders, filterOptions, vendors, vendorList] = await Promise.all([
    listItemsForPurchasePage({
      kpis: purchaseKpiCards(),
      extraRestrict: `${purchaseFilterSql(purchaseFilter)} AND ${pendencyFilterSql("purchase", parsePendencyFilter((key) => params[key], "purchase"))}`,
      kpiRestrict: `${purchaseFilterSql(parsePurchaseFilter(cardGet))} AND ${pendencyFilterSql("purchase", parsePendencyFilter(cardGet, "purchase"))}`,
      page: parsePage(page),
      search: parseQuery(q),
      focusOrderId,
      sort: parseQueueSort(params.sort),
      filter,
    }),
    isRep(user.role) ? Promise.resolve([]) : listRemindersForDepartment(reminderDeptForTable(TABLE)!),
    listOrderListOptions(filter),
    listBoiVendors(),
    listVendorList(),
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
  // Who the client is never reaches this department (lib/client-visibility).
  queue.rows = queue.rows.map((r) => withoutClient(r, user.role));
  const [completions, unreadThreads, drawingDocCounts, pendency] = await Promise.all([
    listDeptCompletions([...new Set(queue.rows.map((o) => String(o.order_id ?? o.id)))]),
    unreadByOrder([...new Set(queue.rows.map((r) => String(r.order_id)))], user),
    // Drawing documents shared with Purchase, per EC, for the button badge.
    countEcDocuments(queue.rows.map((r) => String(r.id)), user.role),
    listPendency([...new Set(queue.rows.map((r) => String(r.order_id)))], "purchase"),
  ]);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <PageHeading
        icon={<Package />}
        title="Purchase"
        description="Add bought-out (BOI) items per EC. Orders with BOI = No are excluded — Purchase has nothing to do for those. BOI and the purchase target date are set by Central Visibility."
      />

      <RemindersPanel reminders={reminders.map((r) => withoutClient(r, user.role))} showClient={false} focusInQueue />

      <PurchaseWorkspace
        split={viewModeOf((await cookies()).get(VIEW_MODE_COOKIE)?.value) === "split"}
        completions={completions}
        pendency={pendency}
        openThreadId={thread}
        focusOrderId={focusOrderId ?? undefined}
        role={user.role}
        unreadThreads={unreadThreads}
        queue={queue}
        kpis={queue.kpis}
        filterOptions={filterOptions}
        vendors={vendors}
        vendorList={vendorList}
        canEdit={canEditChild(user.role, "order_boi_items")}
        openItemId={edit}
        drawingDocCounts={drawingDocCounts}
      />
    </div>
  );
}
