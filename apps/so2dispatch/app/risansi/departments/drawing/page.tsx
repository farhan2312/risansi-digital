import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { VIEW_MODE_COOKIE, viewModeOf } from "@/lib/view-mode";
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
  drawingReadinessReasons,
} from "@/lib/orders";
import { parsePage, parseQuery } from "@/lib/pagination";
import { parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { parsePendencyFilter } from "@/lib/pendency";
import { listPendency, pendencyFilterSql } from "@/lib/pendency-db";
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
import { deptKpiCards, totalHoldCard } from "@/lib/orders";
import { cardBaseGet, toneFor, type KpiCardDef } from "@/lib/kpis";
import { CURVE_STATUSES, ecStatusCountSql, GAD_STATUSES, NOT_REQUIRED, PART_STATUSES, SO_STATES } from "@/lib/drawing-filter";
import { homeFor, mayOpenPage } from "@/lib/view-pages";
import { PageHeading } from "@/components/risansi/page-heading";

export const metadata: Metadata = {
  title: "Drawing | Risansi",
};

export const dynamic = "force-dynamic";

/** Central Visibility holds the SO (alias o): its cards say how many, the hold a badge. */
const CV_HELD = "COALESCE(o.clearance_status, '') = 'Hold'";

const TABLE = "order_drawing" as const;

export default async function DrawingWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewDepartment(user.role, TABLE)) redirect("/risansi/dashboard");
  // 360° View: only the pages picked for them.
  if (!mayOpenPage(user, "/risansi/departments/drawing")) redirect(homeFor(user));

  const params = await searchParams;
  const { edit, thread, page, q } = params;
  // This department's own filter bar, with the department pinned.
  // A Rep sees only their own SOs.
  const filter = scopeToRep(parseDeptFilter((key) => params[key], "drawing"), user);
  // The cards count over the filter bar as set, less the card clicked.
  const cardGet = cardBaseGet((key) => params[key]);
  filter.kpiFilter = parseDeptFilter(cardGet, "drawing");
  // A notification links to an EC (item id) or an SO; either way the queue
  // must open on the page that holds it.
  // Which SO a notification link should open on. Without a link this is
  // immediate; everything else below loads side by side.
  // A reminder (?focus=) lands on its SO in this queue, like a notification.
  const focusOrderId = await resolveFocusOrderId(params.focus ?? thread ?? edit);
  // Drawing's own filters: the SO Open / Closed, and each EC's GAD,
  // Performance Curve and Part Drawing status.
  const drawingFilter = parseDrawingFilter((key) => params[key]);
  // SO versions card: SOs made into a new version (v1 on; a new SO is v0).
  const VERSIONED_SQL = "COALESCE(o.version_no, 0) > 0";
  const versioned = (get: (k: string) => string | string[] | undefined) => (get("drg_ver") === "1" ? ` AND ${VERSIONED_SQL}` : "");
  // Drawing's cards: its SOs open and closed, where their GADs, Performance
  // Curves and Part Drawings stand, and what is overdue against the Drawing
  // target — one compact row, a hairline between the groups.
  const drawingKpiCards = (): KpiCardDef[] => {
    const clear = { drg_so: null, drg_gad: null, drg_pc: null, drg_part: null, drg_ver: null, overdue: null, hold: null } as Record<string, string | null>;
    const none = { so: [] as string[], gad: [] as string[], curve: [] as string[], part: [] as string[] };
    const overdue = deptKpiCards("drawing").find((c) => c.key === "overdue");
    return [
      { key: "all", label: "All SOs", group: "SO", sql: null, params: { ...clear }, tone: "neutral" },
      ...SO_STATES.map((st) => ({
        key: `so:${st}`,
        label: `SO ${st}`,
        group: "SO",
        sql: drawingFilterSql({ ...none, so: [st] }),
        params: { ...clear, drg_so: st },
        // How many of them Central Visibility holds (a badge: they count here).
        held: CV_HELD,
        tone: st === "Closed" ? ("done" as const) : ("pending" as const),
      })),
      ...(overdue ? [{ ...overdue, group: "SO", params: { ...clear, overdue: "1" } }] : []),
      // Its SOs on any hold.
      ...totalHoldCard("drawing", clear, "SO"),
      {
        key: "versioned",
        label: "SO versions",
        group: "SO",
        sql: VERSIONED_SQL,
        params: { ...clear, drg_ver: "1" },
        held: CV_HELD,
        tone: "part" as const,
      },
      ...GAD_STATUSES.map((st) => ({
        key: `gad:${st}`,
        label: `GAD ${st}`,
        group: "GAD",
        sql: drawingFilterSql({ ...none, gad: [st] }),
        params: { ...clear, drg_gad: st },
        // Beside the SOs: how many of their ECs stand there.
        also: { label: "ECs", measure: ecStatusCountSql("gad", st) },
        // How many of them Central Visibility holds (a badge: they count here).
        held: CV_HELD,
        tone: toneFor(st),
      })),
      ...CURVE_STATUSES.filter((st) => st !== NOT_REQUIRED).map((st) => ({
        key: `pc:${st}`,
        label: `Curve ${st}`,
        group: "Performance Curve",
        sql: drawingFilterSql({ ...none, curve: [st] }),
        params: { ...clear, drg_pc: st },
        also: { label: "ECs", measure: ecStatusCountSql("curve", st) },
        // How many of them Central Visibility holds (a badge: they count here).
        held: CV_HELD,
        tone: toneFor(st),
      })),
      ...PART_STATUSES.filter((st) => st !== NOT_REQUIRED).map((st) => ({
        key: `part:${st}`,
        label: `Part ${st}`,
        group: "Part Drawing",
        sql: drawingFilterSql({ ...none, part: [st] }),
        params: { ...clear, drg_part: st },
        also: { label: "ECs", measure: ecStatusCountSql("part", st) },
        // How many of them Central Visibility holds (a badge: they count here).
        held: CV_HELD,
        tone: toneFor(st),
      })),
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
        extraRestrict: `${drawingFilterSql(drawingFilter)} AND ${pendencyFilterSql("drawing", parsePendencyFilter((key) => params[key], "drawing"))}${versioned((key) => params[key])}`,
        kpiRestrict: `${drawingFilterSql(parseDrawingFilter(cardGet))} AND ${pendencyFilterSql("drawing", parsePendencyFilter(cardGet, "drawing"))}${versioned(cardGet)}`,
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
      for (const r of ecs) Object.assign(r, { so_drawing_closed: st.closed, so_drawing_closed_date: st.date, so_drawing_sent: st.sent });
    }
  }
  // An SO matched on one of its ECs: show the ECs that match. Open / Closed is
  // the SO's own, so it keeps every EC.
  if (drawingFilterActive(drawingFilter)) {
    queue.rows = queue.rows.filter((r) => ecMatchesDrawingFilter(r, drawingFilter));
  }
  const orderIds = [...new Set(queue.rows.map((o) => String(o.order_id ?? o.id)))];
  const [completions, unreadThreads, pendency, readinessReasons] = await Promise.all([
    listDeptCompletions(orderIds),
    unreadByOrder(orderIds, user),
    listPendency(orderIds, "drawing"),
    drawingReadinessReasons(orderIds),
  ]);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <PageHeading
        icon={<PenTool />}
        title="Drawing"
        description={<>Every pump EC&apos;s GAD, and its Performance Curve when the SO asks for one — each kept as versions: sent to the client, approved or resubmitted, and the GAD issued to the workshop.</>}
      />

      <RemindersPanel reminders={reminders} focusInQueue />

      <DrawingWorkspace
        split={viewModeOf((await cookies()).get(VIEW_MODE_COOKIE)?.value) === "split"}
        canEdit={canEditChild(user.role, "order_drawing_revisions")}
        completions={completions}
        pendency={pendency}
        readinessReasons={readinessReasons}
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
