import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Boxes } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import {
  canEditSection,
  canViewDepartment,
  isCentral,
  isRep,
  reminderDeptForTable,
} from "@/lib/roles";
import { listItemsForSectionPage,
  orderEcKind,
  parseQueueSort,
  resolveFocusOrderId,
  listDeptCompletions,
  listOrderListOptions,
} from "@/lib/orders";
import { parsePage, parseQuery } from "@/lib/pagination";
import { parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { listRemindersForDepartment } from "@/lib/reminders";
import { ASSEMBLY_CONTEXT_FIELDS, SECTION_BY_TABLE } from "@/lib/order-schema";
import {
  SO_ASSEMBLY_STATUSES,
  SO_PACKING_STATUSES,
  pickStageStatuses,
  pumpViewRestrict,
  soStageStatusSql,
} from "@/lib/assembly";
import { unreadByOrder } from "@/lib/order-messages";
import { DepartmentWorkspace } from "@/components/risansi/department-workspace";
import { RemindersPanel } from "@/components/risansi/reminders-panel";
import { ReportDialogButton } from "@/components/risansi/report-dialog";
import { deptKpiCards, totalHoldCard } from "@/lib/orders";
import { cardBaseGet, toneFor, type KpiCardDef } from "@/lib/kpis";

export const metadata: Metadata = {
  title: "Assembly & Packing | Risansi",
};

export const dynamic = "force-dynamic";

const TABLE = "order_assembly_dispatch" as const;

export default async function AssemblyDispatchWorkspacePage({
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
  // Spare or Pump, as on Planning: the Pump view is assembly (then packing)
  // of the SOs Planning has Partial or Fully ready.
  const focusOrderId = await resolveFocusOrderId(params.focus ?? thread ?? edit);
  // Spare or Pump: as asked, else — following a link to an SO — the side it is on.
  const ecKind: "spare" | "pump" = params.type
    ? /pump/i.test(params.type) ? "pump" : "spare"
    : (await orderEcKind(focusOrderId)) ?? "spare";
  const filter = scopeToRep(
    { ...parseDeptFilter((key) => params[key], "assembly"), types: ecKind === "pump" ? ["Pump", "ROLB"] : ["Spare"] },
    user
  );
  // The cards count over the filter bar as set, less the card clicked.
  const cardGet = cardBaseGet((key) => params[key]);
  filter.kpiFilter = parseDeptFilter(cardGet, "assembly");
  const get = (k: string) => params[k];
  const assemblyStatuses = pickStageStatuses(get, "assembly");
  const packingStatuses = pickStageStatuses(get, "packing");
  // …and as the cards count them: the bar's, less the card clicked.
  const cardAssembly = pickStageStatuses(cardGet, "assembly");
  const cardPacking = pickStageStatuses(cardGet, "packing");
  // The Pump view's cards: the SOs' assembly, then their packing.
  const assemblyPumpCards = (): KpiCardDef[] => {
    const clear = { asm: null, pkg: null, dstatus: null, overdue: null, hold: null } as Record<string, string | null>;
    return [
      { key: "all", label: "All SOs", sql: null, params: { ...clear }, tone: "neutral" },
      // How many pump ECs those SOs hold: a figure, not a filter.
      {
        key: "ecs",
        label: "ECs",
        sql: null,
        params: {},
        tone: "neutral",
        measure: "(SELECT count(*) FROM order_items s WHERE s.order_id = o.id AND s.item_type IN ('Pump', 'ROLB'))",
      },
      ...SO_ASSEMBLY_STATUSES.map((st) => ({
        key: `a:${st}`,
        label: st,
        sql: `${soStageStatusSql("assembly", "o")} = '${st}'`,
        params: { ...clear, asm: st },
        tone: toneFor(st),
      })),
      ...SO_PACKING_STATUSES.map((st) => ({
        key: `p:${st}`,
        label: st,
        sql: `${soStageStatusSql("packing", "o")} = '${st}'`,
        params: { ...clear, pkg: st },
        tone: toneFor(st),
      })),
      // Its SOs on any hold.
      totalHoldCard("assembly", clear),
    ];
  };
  // The Pump view's SOs: those Planning has Partial or Fully ready.
  const pumpRestrict = ecKind === "pump" ? pumpViewRestrict(assemblyStatuses, packingStatuses) : undefined;
  // A notification links to an EC (item id) or an SO; either way the queue
  // must open on the page that holds it.
  // Which SO a notification link should open on. Without a link this is
  // immediate; everything else below loads side by side.
  // A reminder (?focus=) lands on its SO in this queue, like a notification.
  const section = SECTION_BY_TABLE.get(TABLE)!;
  const [queue, reminders, filterOptions] = await Promise.all([
    listItemsForSectionPage(
      TABLE,
      ASSEMBLY_CONTEXT_FIELDS.map((f) => ({
        column: f.column,
        type: f.type,
        // A context field can name its own source table (e.g. Assembly
        // reading Planning's Assembly Date); SO-level context defaults to orders.
        from: f.from ?? ("orders" as const),
      }))
    ,
      {
        kpis: ecKind === "pump" ? assemblyPumpCards() : deptKpiCards("assembly", ["Spare"]),
        kpiRestrict: ecKind === "pump" ? pumpViewRestrict(cardAssembly, cardPacking) : undefined,
        page: parsePage(page),
        search: parseQuery(q),
        focusOrderId,
        filter,
        // By ready date (Planning's readiness date, which a Spare's lots keep).
        sort: parseQueueSort(params.sort),
        extraRestrict: pumpRestrict,
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
  const orderIds = [...new Set(queue.rows.map((o) => String(o.order_id ?? o.id)))];
  const [completions, unreadThreads] = await Promise.all([
    listDeptCompletions(orderIds),
    unreadByOrder(orderIds, user),
  ]);

  // The report carries the queue's filter, search and sort — not which
  // page is open, nor a row being edited. Spare or Pump as shown, said
  // outright: each has its own report.
  const reportQuery = new URLSearchParams([
    ...Object.entries(params).filter(
      (e): e is [string, string] =>
        !!e[1] && !["page", "edit", "thread", "focus", "type"].includes(e[0])
    ),
    ["type", ecKind],
  ]).toString();
  const reportHref = `/risansi/departments/assembly-dispatch/report?${reportQuery}`;

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Boxes className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Assembly &amp; Packing
          </h1>
          <p className="text-sm text-muted">
            Record assembly and packing for each EC. Dispatch takes it from there.
          </p>
        </div>
        {/* Every SO in the queue as filtered: the PDF or the Excel. */}
        <div className="ml-auto flex items-center gap-2">
          <ReportDialogButton
            title={ecKind === "pump" ? "Pump assembly & packing report" : "Spare assembly & packing report"}
            href={reportHref}
          />
        </div>
      </div>

      <RemindersPanel reminders={reminders} showClient={false} focusInQueue />

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
        kpis={queue.kpis}
        filterOptions={filterOptions}
        readonlyFields={ASSEMBLY_CONTEXT_FIELDS}
        canEditCentral={isCentral(user.role)}
        openOrderId={edit}
        ecKind={ecKind}
      />
    </div>
  );
}
