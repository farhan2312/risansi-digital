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
  const [queue, reminders, filterOptions] = await Promise.all([
    listItemsForPurchasePage({
      page: parsePage(page),
      search: parseQuery(q),
      focusOrderId,
      sort: parseQueueSort(params.sort),
      filter,
    }),
    isRep(user.role) ? Promise.resolve([]) : listRemindersForDepartment(reminderDeptForTable(TABLE)!),
    listOrderListOptions(filter),
  ]);

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
        filterOptions={filterOptions}
        canEdit={canEditChild(user.role, "order_boi_items")}
        openItemId={edit}
        drawingDocCounts={drawingDocCounts}
      />
    </div>
  );
}
