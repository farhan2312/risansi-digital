import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PenTool } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import {
  canEditSection,
  canViewDepartment,
  isCentral,
  isRep,
  reminderDeptForTable,
} from "@/lib/roles";
import { listItemsForSectionPage,
  parseQueueSort,
  resolveFocusOrderId,
  listDeptCompletions,
  listOrderListOptions,
} from "@/lib/orders";
import { parsePage, parseQuery } from "@/lib/pagination";
import { parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { listRemindersForDepartment } from "@/lib/reminders";
import {
  DRAWING_CONTEXT_FIELDS,
  SECTION_BY_TABLE,
} from "@/lib/order-schema";
import { unreadByOrder } from "@/lib/order-messages";
import { DepartmentWorkspace } from "@/components/risansi/department-workspace";
import { RemindersPanel } from "@/components/risansi/reminders-panel";

export const metadata: Metadata = {
  title: "Drawing | Risansi",
};

export const dynamic = "force-dynamic";

const TABLE = "order_drawing" as const;

export default async function DrawingWorkspacePage({
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
  const filter = scopeToRep(parseDeptFilter((key) => params[key], "drawing"), user);
  // A notification links to an EC (item id) or an SO; either way the queue
  // must open on the page that holds it.
  // Which SO a notification link should open on. Without a link this is
  // immediate; everything else below loads side by side.
  // A reminder (?focus=) lands on its SO in this queue, like a notification.
  const focusOrderId = await resolveFocusOrderId(params.focus ?? thread ?? edit);
  const section = SECTION_BY_TABLE.get(TABLE)!;
  const [queue, reminders, filterOptions] = await Promise.all([
    listItemsForSectionPage(
      TABLE,
      DRAWING_CONTEXT_FIELDS.map((f) => ({
        column: f.column,
        type: f.type,
        // A context field can name its own source table (e.g. Assembly
        // reading Planning's Assembly Date); SO-level context defaults to orders.
        from: f.from ?? ("orders" as const),
      }))
    ,
      { page: parsePage(page), search: parseQuery(q), focusOrderId, filter, sort: parseQueueSort(params.sort) }
    ),
    isRep(user.role) ? Promise.resolve([]) : listRemindersForDepartment(reminderDeptForTable(TABLE)!),
    listOrderListOptions(filter),
  ]);

  // Unread discussion messages per SO, for the row badge. Rows are ECs in
  // the item-scope workspaces (order_id) and SOs in the SO-scope ones (id).
  // This department's sign-offs for the SOs on this page, for the Complete
  // column. Rows are ECs in the item-scope workspaces and SOs in the others,
  // so the order id comes from whichever the row carries.
  // The rows' sign-offs and unread messages both hang off the queue's SOs and
  // not off each other, so they load together.
  const orderIds = [...new Set(queue.rows.map((o) => String(o.order_id ?? o.id)))];
  const [completions, unreadThreads] = await Promise.all([
    listDeptCompletions(orderIds),
    unreadByOrder(orderIds, user),
  ]);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <PenTool className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Drawing
          </h1>
          <p className="text-sm text-muted">
            Record a revision per drawing issue. You fill the hand-offs to
            Operations and Production; issue to the Client and approval are
            recorded by Central Visibility and shown here read-only.
          </p>
        </div>
      </div>

      <RemindersPanel reminders={reminders} focusInQueue />

      <DepartmentWorkspace
        canEdit={canEditSection(user.role, TABLE)}
        completions={completions}
        openThreadId={thread}
        focusOrderId={focusOrderId ?? undefined}
        role={user.role}
        unreadThreads={unreadThreads}
        table={TABLE}
        fields={section.fields}
        queue={queue}
        filterOptions={filterOptions}
        readonlyFields={DRAWING_CONTEXT_FIELDS}
        // Approval on a revision is Central Visibility's to set — Drawing sees
        // it read-only. Without this the prop defaults to true and Drawing
        // could edit it.
        canEditCentral={isCentral(user.role)}
        openOrderId={edit}
      />
    </div>
  );
}
