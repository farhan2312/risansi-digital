import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PenTool } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import {
  canEditChild,
  canViewDepartment,
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
import { DRAWING_CONTEXT_FIELDS } from "@/lib/order-schema";
import {
  drawingFilterActive,
  drawingFilterSql,
  ecMatchesDrawingFilter,
  soDrawingState,
  parseDrawingFilter,
} from "@/lib/drawing-filter";
import { unreadByOrder } from "@/lib/order-messages";
import { DrawingWorkspace } from "@/components/risansi/drawing-workspace";
import { RemindersPanel } from "@/components/risansi/reminders-panel";
import { deptKpiCards } from "@/lib/orders";
import { toneFor, type KpiCardDef } from "@/lib/kpis";
import { GAD_STATUSES, SO_STATES } from "@/lib/drawing-filter";

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
  // Drawing's own filters: the SO Open / Closed, and each EC's GAD,
  // Performance Curve and Part Drawing status.
  const drawingFilter = parseDrawingFilter((key) => params[key]);
  // Drawing's cards: its SOs open and closed, where their GADs stand, and
  // what is overdue against the Drawing target.
  const drawingKpiCards = (): KpiCardDef[] => {
    const clear = { drg_so: null, drg_gad: null, drg_pc: null, drg_part: null, overdue: null } as Record<string, string | null>;
    const none = { so: [] as string[], gad: [] as string[], curve: [] as string[], part: [] as string[] };
    const overdue = deptKpiCards("drawing").find((c) => c.key === "overdue");
    return [
      { key: "all", label: "All SOs", sql: null, params: { ...clear }, tone: "neutral" },
      ...SO_STATES.map((st) => ({
        key: `so:${st}`,
        label: `SO ${st}`,
        sql: drawingFilterSql({ ...none, so: [st] }),
        params: { ...clear, drg_so: st },
        tone: st === "Closed" ? ("done" as const) : ("pending" as const),
      })),
      ...GAD_STATUSES.map((st) => ({
        key: `gad:${st}`,
        label: `GAD ${st}`,
        sql: drawingFilterSql({ ...none, gad: [st] }),
        params: { ...clear, drg_gad: st },
        tone: toneFor(st),
      })),
      ...(overdue ? [{ ...overdue, params: { ...clear, overdue: "1" } }] : []),
    ];
  };
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
      {
        kpis: drawingKpiCards(),
        page: parsePage(page),
        search: parseQuery(q),
        focusOrderId,
        filter,
        sort: parseQueueSort(params.sort),
        extraRestrict: drawingFilterSql(drawingFilter),
      }
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
  // Each SO's Open / Closed and closing day, from all its ECs — worked out
  // before a filter narrows the ECs shown.
  {
    const byOrder = new Map<string, typeof queue.rows>();
    for (const r of queue.rows) {
      const k = String(r.order_id);
      byOrder.set(k, [...(byOrder.get(k) ?? []), r]);
    }
    for (const [, ecs] of byOrder) {
      const st = soDrawingState(ecs);
      for (const r of ecs) Object.assign(r, { so_drawing_closed: st.closed, so_drawing_closed_date: st.date });
    }
  }
  // An SO matched on one of its ECs: show the ECs that match. Open / Closed is
  // the SO's own, so it keeps every EC.
  if (drawingFilterActive(drawingFilter)) {
    queue.rows = queue.rows.filter((r) => ecMatchesDrawingFilter(r, drawingFilter));
  }
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
            Every pump EC&apos;s GAD, and its Performance Curve when the SO asks
            for one — each kept as versions: sent to the client, approved or
            resubmitted, and the GAD issued to the workshop.
          </p>
        </div>
      </div>

      <RemindersPanel reminders={reminders} focusInQueue />

      <DrawingWorkspace
        canEdit={canEditChild(user.role, "order_drawing_revisions")}
        completions={completions}
        openThreadId={thread}
        openItemId={edit}
        focusOrderId={focusOrderId ?? undefined}
        role={user.role}
        unreadThreads={unreadThreads}
        queue={queue}
        kpis={queue.kpis}
        filterOptions={filterOptions}
      />
    </div>
  );
}
