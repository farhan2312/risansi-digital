// The Central Dashboard's figures, for Spare SOs or Pump SOs: headline
// numbers, twelve months of intake and dispatch, where dispatch and payment
// stand, each department's progress, the order book by zone and client, and
// the SOs late for dispatch. Everything is counted in SQL over open SOs
// (not cancelled or diverted) unless said otherwise.

import { query } from "@/lib/db";
import { orderOpenSql, releasedSql, spareEcSql } from "@/lib/dept-view";
import { ecGadStatusSql } from "@/lib/drawing-filter";
import { ASSEMBLY_STATE_SQL, ecDeptStateSql, soDeptStateSql } from "@/lib/orders";
import { NOT_APPLICABLE, PENDING, statusesFor } from "@/lib/dept-status";
import { SPARE_PLANNING_STATUSES } from "@/lib/order-schema";

export type DashKind = "spare" | "pump";
export type Tone = "done" | "progress" | "pending" | "critical" | "na";

export type Bucket = { label: string; tone: Tone; count: number };
export type DeptBar = { key: string; label: string; unit: "ECs" | "SOs"; href: string; buckets: Bucket[] };
export type MonthPoint = { month: string; intake: number; sos: number; dispatched: number; dispatches: number };
export type Share = { label: string; count: number; value: number };
export type LateSo = { order_id: string; so_no: string | null; client_name: string | null; target: string; days_late: number; status: string };

export type DashboardData = {
  kind: DashKind;
  kpis: {
    activeSos: number;
    closedSos: number;
    ecs: number;
    qty: number;
    orderValue: number;
    fullyDispatched: number;
    overdueDispatch: number;
    dueThisWeek: number;
    paymentHolds: number;
    notReleased: number;
  };
  months: MonthPoint[];
  dispatch: Bucket[];
  payment: Bucket[];
  depts: DeptBar[];
  zones: Share[];
  clients: Share[];
  late: LateSo[];
};

/** An SO's value in INR: its conversion, else its own value when it is in INR. */
const VALUE_INR = (o = "o") =>
  `COALESCE(${o}.order_value_inr, CASE WHEN COALESCE(NULLIF(TRIM(${o}.order_currency), ''), 'INR') = 'INR' THEN ${o}.order_value END)`;

const TODAY = "(now() AT TIME ZONE 'Asia/Kolkata')::date";
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** The SO is of this kind: its own type, or any of its ECs'. */
function kindSo(kind: DashKind, o = "o"): string {
  const types = kind === "spare" ? ["Spare"] : ["Pump", "ROLB"];
  const list = types.map(lit).join(", ");
  return `(TRIM(COALESCE(${o}.order_type, '')) IN (${list})
           OR EXISTS (SELECT 1 FROM order_items ks WHERE ks.order_id = ${o}.id
                        AND TRIM(COALESCE(ks.item_type, '')) IN (${list})))`;
}

/** The EC is of this kind. */
function kindEc(kind: DashKind, it = "it", o = "o"): string {
  return kind === "spare" ? spareEcSql(it, o) : `NOT (${spareEcSql(it, o)})`;
}

/** A Rep or Rep Manager: only their reps' SOs. */
function repScope(repNames: string[] | null, o = "o"): string {
  if (!repNames) return "TRUE";
  if (repNames.length === 0) return "FALSE";
  return `lower(TRIM(COALESCE(${o}.reps, ''))) IN (${repNames.map((r) => lit(r.trim().toLowerCase())).join(", ")})`;
}

/** A tone for a status word, so every department's bar reads the same way. */
function toneOf(status: string): Tone {
  const s = status.toLowerCase();
  if (s === "n/a" || s === NOT_APPLICABLE.toLowerCase() || s === "after receipt") return "na";
  if (/hold/.test(s)) return "critical";
  if (/^(fully|payment rcvd|received|submitted|approved$|issued to planning|assembled$|packed$|challan filed)/.test(s)) return "done";
  if (/(partial|partly|lot|in plan|advance|sent|resubmit|approved|in progress)/.test(s)) return "progress";
  return "pending";
}

/** Counts per bucket in one query: rows of `from` matching `where`. */
async function countBuckets(
  from: string,
  where: string,
  defs: { label: string; tone: Tone; sql: string }[]
): Promise<Bucket[]> {
  if (defs.length === 0) return [];
  const cols = defs.map((d, i) => `count(*) FILTER (WHERE ${d.sql})::int AS b${i}`).join(", ");
  const r = await query<Record<string, number>>(`SELECT ${cols} ${from} WHERE ${where}`);
  const row = r.rows[0] ?? {};
  return defs.map((d, i) => ({ label: d.label, tone: d.tone, count: Number(row[`b${i}`] ?? 0) }));
}

/** A pump EC's done quantity from its lots (assembled or packed). */
function lotDoneQty(col: "assembled_date" | "packed_date", it = "it"): string {
  return `(SELECT COALESCE(sum(rl.qty), 0) FROM order_ready_lots rl WHERE rl.item_id = ${it}.id AND rl.${col} IS NOT NULL)`;
}
function qtyStageBuckets(done: string, words: [string, string, string]): { label: string; tone: Tone; sql: string }[] {
  const q = "COALESCE(it.quantity, 0)";
  return [
    { label: words[2], tone: "done", sql: `${q} > 0 AND ${done} >= ${q}` },
    { label: words[1], tone: "progress", sql: `${done} > 0 AND NOT (${q} > 0 AND ${done} >= ${q})` },
    { label: words[0], tone: "pending", sql: `${done} <= 0` },
  ];
}

export async function getDashboard(kind: DashKind, repNames: string[] | null): Promise<DashboardData> {
  const so = `${kindSo(kind)} AND ${repScope(repNames)}`;
  const open = orderOpenSql("o");
  const target = "COALESCE(o.dispatch_target_revised_date, o.dispatch_target_date)";
  const status = `lower(COALESCE(NULLIF(o.status_override, ''), NULLIF(o.dispatch_status, ''), 'Pending'))`;
  const notFully = `${status} <> 'fully dispatch'`;

  const ecFrom = "FROM order_items it JOIN orders o ON o.id = it.order_id";
  const ecWhere = `${so} AND ${open} AND ${releasedSql("o")} AND ${kindEc(kind)}`;
  const soFrom = "FROM orders o";
  const soWhere = `${so} AND ${open} AND ${releasedSql("o")}`;

  // ---- headline numbers
  const kpiQ = query<Record<string, string | number | null>>(
    `SELECT count(*) FILTER (WHERE ${open})::int AS active,
            count(*) FILTER (WHERE NOT ${open})::int AS closed,
            COALESCE(sum(${VALUE_INR()}) FILTER (WHERE ${open}), 0)::text AS value,
            count(*) FILTER (WHERE ${open} AND ${status} = 'fully dispatch')::int AS fully,
            count(*) FILTER (WHERE ${open} AND ${notFully} AND ${target} < ${TODAY})::int AS overdue,
            count(*) FILTER (WHERE ${open} AND ${notFully} AND ${target} BETWEEN ${TODAY} AND ${TODAY} + 7)::int AS due7,
            count(*) FILTER (WHERE ${open} AND lower(COALESCE(a.payment_status, '')) = 'outstanding hold')::int AS pay_holds,
            count(*) FILTER (WHERE ${open} AND NOT (${releasedSql("o")}))::int AS not_released
       FROM orders o LEFT JOIN order_accounts a ON a.order_id = o.id
      WHERE ${so}`
  );
  const ecQ = query<{ ecs: number; qty: number }>(
    `SELECT count(*)::int AS ecs, COALESCE(sum(it.quantity), 0)::int AS qty
       FROM order_items it JOIN orders o ON o.id = it.order_id
      WHERE ${so} AND ${open} AND ${kindEc(kind)}`
  );

  // ---- twelve months: what was booked, and what went out
  const monthsQ = query<MonthPoint>(
    `WITH m AS (
       SELECT to_char(d, 'YYYY-MM') AS month
         FROM generate_series(date_trunc('month', ${TODAY}) - interval '11 months', date_trunc('month', ${TODAY}), interval '1 month') d
     ),
     intake AS (
       SELECT to_char(date_trunc('month', o.so_date), 'YYYY-MM') AS month,
              COALESCE(sum(${VALUE_INR()}), 0) AS v, count(*) AS n
         FROM orders o
        WHERE ${so} AND ${open} AND o.so_date >= date_trunc('month', ${TODAY}) - interval '11 months'
        GROUP BY 1
     ),
     sent AS (
       SELECT to_char(date_trunc('month', COALESCE(i.invoice_date, i.challan_date)), 'YYYY-MM') AS month,
              COALESCE(sum(COALESCE(i.invoice_value, i.challan_value, 0)
                * CASE WHEN COALESCE(o.order_value, 0) > 0 THEN COALESCE(${VALUE_INR()}, 0) / o.order_value ELSE 1 END), 0) AS v,
              count(*) AS n
         FROM order_invoices i JOIN orders o ON o.id = i.order_id
        WHERE ${so} AND COALESCE(i.invoice_date, i.challan_date) >= date_trunc('month', ${TODAY}) - interval '11 months'
        GROUP BY 1
     )
     SELECT m.month, COALESCE(intake.v, 0)::float AS intake, COALESCE(intake.n, 0)::int AS sos,
            COALESCE(sent.v, 0)::float AS dispatched, COALESCE(sent.n, 0)::int AS dispatches
       FROM m LEFT JOIN intake USING (month) LEFT JOIN sent USING (month)
      ORDER BY m.month`
  );

  // ---- dispatch and payment, per open SO
  const dispatchQ = countBuckets("FROM orders o", `${so} AND ${open}`, [
    { label: "Fully dispatched", tone: "done", sql: `${status} = 'fully dispatch'` },
    { label: "Lot dispatched", tone: "progress", sql: `${status} = 'lot dispatch'` },
    { label: "Pending", tone: "pending", sql: `${status} NOT IN ('fully dispatch', 'lot dispatch')` },
  ]);
  const pay = "lower(COALESCE(a.payment_status, ''))";
  const paymentQ = countBuckets("FROM orders o LEFT JOIN order_accounts a ON a.order_id = o.id", `${so} AND ${open}`, [
    { label: "Received", tone: "done", sql: `${pay} = 'payment rcvd'` },
    { label: "Advance received", tone: "progress", sql: `${pay} LIKE 'advance rcvd%'` },
    { label: "Awaited", tone: "pending", sql: `${pay} IN ('payment awaited', 'after receipt')` },
    { label: "On hold", tone: "critical", sql: `${pay} = 'outstanding hold'` },
    { label: "Not set", tone: "na", sql: `${pay} = ''` },
  ]);

  // ---- each department, in its own words
  const soDept = (key: "billing" | "accounts" | "dispatch", label: string, href: string) =>
    countBuckets(
      soFrom,
      soWhere,
      statusesFor(key).map((s) => ({ label: s, tone: toneOf(s), sql: soDeptStateSql(key, s) }))
    ).then((buckets): DeptBar => ({ key, label, unit: "SOs", href, buckets }));
  const ecDept = (key: string, label: string, href: string, defs: { label: string; tone: Tone; sql: string }[]) =>
    countBuckets(ecFrom, ecWhere, defs).then((buckets): DeptBar => ({ key, label, unit: "ECs", href, buckets }));
  const fromStatuses = (dept: "purchase" | "quality", list: string[]) =>
    list.map((s) => ({ label: s, tone: toneOf(s), sql: ecDeptStateSql(dept, s) }));

  const deptQs: Promise<DeptBar>[] =
    kind === "pump"
      ? [
          ecDept("drawing", "Drawing (GAD)", "/risansi/departments/drawing", [
            { label: "Issued to planning", tone: "done", sql: `${ecGadStatusSql("it")} = 'Issued to planning'` },
            { label: "Approved by client", tone: "progress", sql: `${ecGadStatusSql("it")} = 'Approved by client'` },
            { label: "With client", tone: "progress", sql: `${ecGadStatusSql("it")} IN ('Sent to client – approval pending', 'Resubmit')` },
            { label: "Pending", tone: "pending", sql: `${ecGadStatusSql("it")} = 'Pending'` },
          ]),
          ecDept("purchase", "Purchase (BOI)", "/risansi/departments/purchase", fromStatuses("purchase", ["Received", PENDING, NOT_APPLICABLE])),
          ecDept("quality", "Quality", "/risansi/departments/qc", fromStatuses("quality", ["Submitted", PENDING, NOT_APPLICABLE])),
          ecDept("planning", "Planning", "/risansi/departments/planning?type=Pump%2CROLB", [
            {
              label: "Fully ready",
              tone: "done",
              sql: `COALESCE(it.quantity, 0) > 0 AND COALESCE((SELECT pl.ready_qty FROM order_planning pl WHERE pl.item_id = it.id), 0) >= it.quantity`,
            },
            {
              label: "Partially ready",
              tone: "progress",
              sql: `COALESCE((SELECT pl.ready_qty FROM order_planning pl WHERE pl.item_id = it.id), 0) > 0
                    AND NOT (COALESCE(it.quantity, 0) > 0 AND COALESCE((SELECT pl.ready_qty FROM order_planning pl WHERE pl.item_id = it.id), 0) >= it.quantity)`,
            },
            { label: "Pending", tone: "pending", sql: `COALESCE((SELECT pl.ready_qty FROM order_planning pl WHERE pl.item_id = it.id), 0) <= 0` },
          ]),
          ecDept("assembly", "Assembly", "/risansi/departments/assembly-dispatch?type=Pump%2CROLB", qtyStageBuckets(lotDoneQty("assembled_date"), ["Pending", "Partially assembled", "Assembled"])),
          ecDept("packing", "Packing", "/risansi/departments/assembly-dispatch?type=Pump%2CROLB", qtyStageBuckets(lotDoneQty("packed_date"), ["Pending", "Partially packed", "Packed"])),
          soDept("billing", "Proforma Invoice", "/risansi/departments/billing"),
          soDept("accounts", "Accounts", "/risansi/departments/accounts"),
          soDept("dispatch", "Dispatch", "/risansi/departments/dispatch"),
        ]
      : [
          ecDept("planning", "Planning", "/risansi/departments/planning", [
            ...SPARE_PLANNING_STATUSES.map((s) => ({ label: s, tone: toneOf(s), sql: ecDeptStateSql("planning", s) })),
            { label: "Not set", tone: "pending" as Tone, sql: ecDeptStateSql("planning", PENDING) },
          ]),
          ecDept("assembly", "Assembly & Packing", "/risansi/departments/assembly-dispatch", [
            { label: "Fully packed", tone: "done", sql: `${ASSEMBLY_STATE_SQL("it")} = 'Fully packed'` },
            { label: "Partially packed", tone: "progress", sql: `${ASSEMBLY_STATE_SQL("it")} = 'Partially packed'` },
            { label: "Ready, not packed", tone: "pending", sql: `${ASSEMBLY_STATE_SQL("it")} = 'In Progress'` },
            { label: "Not ready", tone: "na", sql: `${ASSEMBLY_STATE_SQL("it")} = 'Pending'` },
          ]),
          soDept("billing", "Proforma Invoice", "/risansi/departments/billing"),
          soDept("accounts", "Accounts", "/risansi/departments/accounts"),
          soDept("dispatch", "Dispatch", "/risansi/departments/dispatch"),
        ];

  // ---- the open order book by zone and by client
  const zonesQ = query<Share>(
    `SELECT COALESCE(NULLIF(initcap(lower(TRIM(o.zone))), ''), 'Not set') AS label, count(*)::int AS count,
            COALESCE(sum(${VALUE_INR()}), 0)::float AS value
       FROM orders o WHERE ${so} AND ${open} AND ${notFully}
      GROUP BY 1 ORDER BY value DESC`
  );
  const clientsQ = query<Share>(
    `SELECT COALESCE(NULLIF(TRIM(o.client_name), ''), 'Not set') AS label, count(*)::int AS count,
            COALESCE(sum(${VALUE_INR()}), 0)::float AS value
       FROM orders o WHERE ${so} AND ${open} AND ${notFully}
      GROUP BY 1 ORDER BY value DESC LIMIT 8`
  );

  // ---- late for dispatch, latest first
  const lateQ = query<LateSo>(
    `SELECT o.id AS order_id, o.so_no, o.client_name, to_char(${target}, 'YYYY-MM-DD') AS target,
            (${TODAY} - ${target})::int AS days_late,
            COALESCE(NULLIF(o.status_override, ''), NULLIF(o.dispatch_status, ''), 'Pending') AS status
       FROM orders o
      WHERE ${so} AND ${open} AND ${notFully} AND ${target} < ${TODAY}
      ORDER BY days_late DESC, o.sl_no
      LIMIT 8`
  );

  const [kpi, ec, months, dispatch, payment, depts, zones, clients, late] = await Promise.all([
    kpiQ,
    ecQ,
    monthsQ,
    dispatchQ,
    paymentQ,
    Promise.all(deptQs),
    zonesQ,
    clientsQ,
    lateQ,
  ]);
  const k = kpi.rows[0] ?? {};
  const n = (v: unknown) => Number(v ?? 0) || 0;

  // Zones past the sixth fold into Other.
  const zoneRows = zones.rows.map((z) => ({ ...z, count: n(z.count), value: n(z.value) }));
  const topZones =
    zoneRows.length > 6
      ? [
          ...zoneRows.slice(0, 5),
          zoneRows.slice(5).reduce((t, z) => ({ label: "Other", count: t.count + z.count, value: t.value + z.value }), { label: "Other", count: 0, value: 0 }),
        ]
      : zoneRows;

  return {
    kind,
    kpis: {
      activeSos: n(k.active),
      closedSos: n(k.closed),
      ecs: n(ec.rows[0]?.ecs),
      qty: n(ec.rows[0]?.qty),
      orderValue: n(k.value),
      fullyDispatched: n(k.fully),
      overdueDispatch: n(k.overdue),
      dueThisWeek: n(k.due7),
      paymentHolds: n(k.pay_holds),
      notReleased: n(k.not_released),
    },
    months: months.rows.map((m) => ({ ...m, intake: n(m.intake), sos: n(m.sos), dispatched: n(m.dispatched), dispatches: n(m.dispatches) })),
    dispatch,
    payment,
    depts,
    zones: topZones,
    clients: clients.rows.map((c) => ({ ...c, count: n(c.count), value: n(c.value) })),
    late: late.rows.map((l) => ({ ...l, days_late: n(l.days_late) })),
  };
}
