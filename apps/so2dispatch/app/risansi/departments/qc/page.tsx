import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { VIEW_MODE_COOKIE, viewModeOf } from "@/lib/view-mode";
import { ClipboardCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import {
  canEditQcDocuments,
  canViewDepartment,
  isRep,
  reminderDeptForTable,
} from "@/lib/roles";
import {
  listItemsForSectionPage,
  parseQueueSort,
  resolveFocusOrderId,
  listDeptCompletions,
  listOrderListOptions,
} from "@/lib/orders";
import { parsePage, parseQuery } from "@/lib/pagination";
import { parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { listRemindersForDepartment } from "@/lib/reminders";
import { QC_CONTEXT_FIELDS } from "@/lib/order-schema";
import { unreadByOrder } from "@/lib/order-messages";
import { QcWorkspace } from "@/components/risansi/qc-workspace";
import { listPendency } from "@/lib/pendency-db";
import { listEcAssembly } from "@/lib/ec-assembly";
import { ecStageStatus } from "@/lib/assembly";
import { RemindersPanel } from "@/components/risansi/reminders-panel";
import { cardBaseGet, type KpiCardDef } from "@/lib/kpis";
import {
  ecQcStatus,
  parseQcFilter,
  qcFilterActive,
  qcFilterSql,
  soQcState,
} from "@/lib/qc-filter";
import { qcCards } from "@/lib/dept-cards";
import { homeFor, mayOpenPage } from "@/lib/view-pages";
import { PageHeading } from "@/components/risansi/page-heading";

export const metadata: Metadata = {
  title: "Quality | Risansi",
};

export const dynamic = "force-dynamic";

const TABLE = "order_qc" as const;

export default async function QcWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewDepartment(user.role, TABLE)) redirect("/risansi/dashboard");
  // 360° View: only the pages picked for them.
  if (!mayOpenPage(user, "/risansi/departments/qc")) redirect(homeFor(user));

  const params = await searchParams;
  const { edit, thread, page, q } = params;
  // This department's own filter bar, with the department pinned.
  // A Rep sees only their own SOs.
  const filter = scopeToRep(parseDeptFilter((key) => params[key], "quality"), user);
  // The cards count over the filter bar as set, less the card clicked.
  const cardGet = cardBaseGet((key) => params[key]);
  filter.kpiFilter = parseDeptFilter(cardGet, "quality");
  // A notification links to an EC (item id) or an SO; either way the queue
  // must open on the page that holds it.
  // Which SO a notification link should open on. Without a link this is
  // immediate; everything else below loads side by side.
  // A reminder (?focus=) lands on its SO in this queue, like a notification.
  const focusOrderId = await resolveFocusOrderId(params.focus ?? thread ?? edit);
  // Quality gives the documents the SO names (Central and Admin may too).
  const canEdit = canEditQcDocuments(user.role);
  // Quality's own filters: the SO's Open / Closed and each EC's documents status.
  const qcFilter = parseQcFilter((key) => params[key]);
  // The cards: SOs open and closed (and overdue), then the ECs by documents
  // status — those count ECs, and filter like the rest.
  const qcKpiCards = (): KpiCardDef[] => qcCards();
  const [queue, reminders, filterOptions] = await Promise.all([
    listItemsForSectionPage(
      TABLE,
      QC_CONTEXT_FIELDS.map((f) => ({
        column: f.column,
        type: f.type,
        // A context field can name its own source table (e.g. Assembly
        // reading Planning's Assembly Date); SO-level context defaults to orders.
        from: f.from ?? ("orders" as const),
      }))
    ,
      {
        page: parsePage(page),
        search: parseQuery(q),
        focusOrderId,
        filter,
        sort: parseQueueSort(params.sort),
        kpis: qcKpiCards(),
        extraRestrict: qcFilterSql(qcFilter),
        kpiRestrict: qcFilterSql(parseQcFilter(cardGet)),
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
  // Each SO's Open / Closed from all its ECs — worked out before a filter
  // narrows the ECs shown; then only the ECs at the status asked.
  // Every EC of an SO that needs Quality, assembled or not; its assembly shown beside it.
  const assembly = await listEcAssembly(queue.rows.map((r) => String(r.id)));
  // A pump EC none of which is assembled reads EC not assembled, not Pending.
  for (const r of queue.rows) {
    const a = assembly[String(r.id)];
    Object.assign(r, { qc_not_assembled: !!a && a.assembled <= 0 });
  }
  {
    const byOrder = new Map<string, typeof queue.rows>();
    for (const r of queue.rows) byOrder.set(String(r.order_id), [...(byOrder.get(String(r.order_id)) ?? []), r]);
    for (const [, ecs] of byOrder) {
      const st = soQcState(ecs);
      for (const r of ecs) Object.assign(r, { qc_so_state: st });
    }
  }
  // Partially or fully assembled, as asked: only the ECs that are.
  if (qcFilter.asm.length) {
    queue.rows = queue.rows.filter((r) => {
      const a = assembly[String(r.id)];
      return !!a && qcFilter.asm.includes(ecStageStatus(a.assembled, a.qty, "assembly"));
    });
  }
  if (qcFilterActive(qcFilter) && qcFilter.ec.length) {
    queue.rows = queue.rows.filter((r) => qcFilter.ec.includes(ecQcStatus(r)));
  }
  const orderIds = [...new Set(queue.rows.map((o) => String(o.order_id ?? o.id)))];
  const [completions, unreadThreads, pendency] = await Promise.all([
    listDeptCompletions(orderIds),
    unreadByOrder(orderIds, user),
    listPendency(orderIds, "qc"),
  ]);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <PageHeading
        icon={<ClipboardCheck />}
        title="Quality"
        description="The QC documents each SO needs (MTC, IIR, Test Report, QAP and the rest) are set on the order. Give each one per EC as a SharePoint link; the EC is submitted once all are in."
      />

      <RemindersPanel reminders={reminders} showClient={false} focusInQueue />

      <QcWorkspace
        queue={queue}
        kpis={queue.kpis}
        canEdit={canEdit}
        completions={completions}
        assembly={assembly}
        openThreadId={thread}
        openItemId={edit}
        focusOrderId={focusOrderId ?? undefined}
        role={user.role}
        unreadThreads={unreadThreads}
        filterOptions={filterOptions}
        pendency={pendency}
        split={viewModeOf((await cookies()).get(VIEW_MODE_COOKIE)?.value) === "split"}
      />
    </div>
  );
}
