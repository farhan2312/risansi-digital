import "server-only";
import { query } from "@/lib/db";
import { assemblyDueSql, orderOpenSql, orderStatusSql } from "@/lib/dept-view";
import { ASSEMBLY_STATE_SQL } from "@/lib/orders";
import {
  SPARE_DISPATCH_STATUSES,
  shortDate,
  shortMonth,
  todayIst,
  type SparesReportFilter,
  type SpareStage,
} from "@/lib/spares-report-filter";

// The Spares report: what each department did in a period, and where every
// active Spare SO stands today — Planning, Assembly & Packing and Dispatch —
// with the SOs behind each number. One loader for the page and the PDF.

/** One Spare SO, as the report reads it. A Spare is planned and packed as one. */
export type SpareSoRow = {
  id: string;
  sl_no: number;
  so_no: string | null;
  so_date: string | null;
  client_name: string | null;
  bill_mode: string | null;
  ecs: number;
  planning_status: string;
  /** Planning's readiness date (the latest among the ECs). */
  readiness_date: string | null;
  assembly_status: string;
  /** The earliest ready date of a lot not packed yet. */
  waiting_since: string | null;
  /** The last packing date (a lot's, or the EC's own). */
  packed_on: string | null;
  dispatch_status: string;
  /** The last dispatch date (delivery, else invoice or challan date). */
  dispatched_on: string | null;
  /** When Assembly & Packing owes it (lib/dept-view assemblyDueSql). */
  pack_due: string | null;
  pis: number;
  stage: SpareStage;
  /** Days since waiting_since, when it has passed. */
  waiting_days: number | null;
  /** Days past pack_due; 0 when on time. */
  pack_overdue: number;
};

export type PiLine = {
  order_id: string;
  so_no: string | null;
  client_name: string | null;
  pi_no: string | null;
  pi_date: string | null;
  pi_value: string | null;
  currency: string | null;
  term: string | null;
};

export type PaymentLine = {
  order_id: string;
  so_no: string | null;
  client_name: string | null;
  payment_status: string | null;
  confirmed_on: string | null;
  amount_received: string | null;
  balance: string | null;
  currency: string | null;
};

/** Counts per period bucket (a week, or a month for long ranges). */
export type ActivityBucket = {
  label: string;
  created: number;
  pis: number;
  ready: number;
  packed: number;
  dispatched: number;
};

export type SparesReport = {
  filter: SparesReportFilter;
  today: string;
  rows: SpareSoRow[];
  /** Status values present among active Spare SOs — the filter's choices. */
  options: { planning: string[]; assembly: string[]; dispatch: string[] };
  activity: {
    created: SpareSoRow[];
    pis: PiLine[];
    payments: PaymentLine[];
    /** Distinct SOs with work in the period, per department. */
    readySos: number;
    packedSos: number;
    dispatchedSos: number;
    buckets: ActivityBucket[];
    bucketBy: "week" | "month";
  };
  /** Waiting to pack, by days since ready. */
  ageing: { label: string; count: number; tone: "ok" | "warn" | "late" | "none" }[];
};

export const PLANNING_ORDER = ["Fully ready", "Partial ready", "In plan", "Date awaited"];
// A Spare with no readiness lot is not with Assembly & Packing yet — it has no
// status there, shown as "Not ready yet".
export const ASSEMBLY_ORDER = ["Fully ready", "Partial ready", "Partially packed", "Fully packed", "Not ready yet"];

function stageOf(r: { assembly_status: string; dispatch_status: string }): SpareStage {
  if (r.dispatch_status === "Fully dispatch") return "dispatched";
  if (r.assembly_status === "Fully ready" || r.assembly_status === "Partial ready") return "to_pack";
  if (r.assembly_status === "Fully packed" || r.assembly_status === "Partially packed") return "packed";
  return "not_ready";
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

/** Monday of the week a date falls in. */
function weekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const SPARE = `lower(btrim(COALESCE(o.order_type, ''))) = 'spare' AND ${orderOpenSql("o")}`;
const ymd = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`;

export async function loadSparesReport(filter: SparesReportFilter): Promise<SparesReport> {
  const today = todayIst();

  const soRows = await query<Omit<SpareSoRow, "stage" | "waiting_days" | "pack_overdue">>(
    `SELECT o.id, o.sl_no::int AS sl_no, o.so_no, ${ymd("o.so_date")} AS so_date, o.client_name, o.bill_mode,
            (SELECT count(*) FROM order_items it WHERE it.order_id = o.id)::int AS ecs,
            COALESCE((SELECT COALESCE(NULLIF(btrim(pl.actual_spare_status), ''), NULLIF(btrim(pl.planning_status), ''))
                        FROM order_items it LEFT JOIN order_planning pl ON pl.item_id = it.id
                       WHERE it.order_id = o.id ORDER BY it.seq LIMIT 1), 'Date awaited') AS planning_status,
            (SELECT ${ymd("max(pl.planning_readiness_date)")}
               FROM order_items it JOIN order_planning pl ON pl.item_id = it.id
              WHERE it.order_id = o.id) AS readiness_date,
            COALESCE(NULLIF((SELECT ${ASSEMBLY_STATE_SQL("it")} FROM order_items it
                       WHERE it.order_id = o.id ORDER BY it.seq LIMIT 1), 'Pending'), 'Not ready yet') AS assembly_status,
            (SELECT ${ymd("min(rl.ready_date)")}
               FROM order_items it JOIN order_ready_lots rl ON rl.item_id = it.id
              WHERE it.order_id = o.id AND rl.packed_date IS NULL AND rl.ready_date IS NOT NULL) AS waiting_since,
            (SELECT ${ymd("max(d)")} FROM (
               SELECT rl.packed_date AS d FROM order_items it JOIN order_ready_lots rl ON rl.item_id = it.id
                WHERE it.order_id = o.id
               UNION ALL
               SELECT ad.actual_packing_date FROM order_items it JOIN order_assembly_dispatch ad ON ad.item_id = it.id
                WHERE it.order_id = o.id) p) AS packed_on,
            ${orderStatusSql("o")} AS dispatch_status,
            (SELECT ${ymd("max(COALESCE(i.delivery_date, i.invoice_date, i.challan_date))")}
               FROM order_invoices i WHERE i.order_id = o.id) AS dispatched_on,
            (SELECT ${ymd(`min(${assemblyDueSql("it")})`)} FROM order_items it WHERE it.order_id = o.id) AS pack_due,
            (SELECT count(*) FROM order_billing_docs b WHERE b.order_id = o.id)::int AS pis
       FROM orders o
      WHERE ${SPARE}
      ORDER BY o.sl_no DESC`
  );

  const all: SpareSoRow[] = soRows.rows.map((r) => {
    const waiting = r.waiting_since && r.waiting_since <= today ? daysBetween(r.waiting_since, today) : null;
    const late = r.pack_due && r.pack_due < today ? daysBetween(r.pack_due, today) : 0;
    return { ...r, stage: stageOf(r), waiting_days: waiting, pack_overdue: late };
  });

  // The filter's choices come from the data, the known ones first.
  const present = (values: string[], known: string[]) => {
    const set = new Set(values);
    return [...known.filter((k) => set.has(k)), ...[...set].filter((v) => !known.includes(v)).sort()];
  };
  const options = {
    planning: present(all.map((r) => r.planning_status), PLANNING_ORDER),
    assembly: present(all.map((r) => r.assembly_status), ASSEMBLY_ORDER),
    dispatch: SPARE_DISPATCH_STATUSES,
  };

  const rows = all.filter(
    (r) =>
      (filter.scope === "all" || (!!r.so_date && r.so_date >= filter.from && r.so_date <= filter.to)) &&
      (!filter.planning.length || filter.planning.includes(r.planning_status)) &&
      (!filter.assembly.length || filter.assembly.includes(r.assembly_status)) &&
      (!filter.dispatch.length || filter.dispatch.includes(r.dispatch_status))
  );
  const ids = rows.map((r) => r.id);
  // "Made ready" counts a lot once its ready date has come, not a planned one.
  const readyTo = filter.to < today ? filter.to : today;
  const params = [ids, filter.from, filter.to];

  const [pis, payments, ready, packed, dispatched] = await Promise.all([
    query<PiLine>(
      `SELECT o.id AS order_id, o.so_no, o.client_name, b.pi_no, ${ymd("b.pi_date")} AS pi_date,
              b.pi_value::text AS pi_value, COALESCE(NULLIF(o.order_currency, ''), 'INR') AS currency,
              CASE WHEN t.id IS NULL THEN NULL
                   ELSE concat_ws(' ', CASE WHEN t.percent IS NOT NULL THEN rtrim(rtrim(t.percent::text, '0'), '.') || '%' END, t.term) END AS term
         FROM order_billing_docs b
         JOIN orders o ON o.id = b.order_id
         LEFT JOIN order_payment_terms t ON t.id = b.payment_term_id
        WHERE b.order_id = ANY($1::uuid[]) AND b.pi_date BETWEEN $2::date AND $3::date
        ORDER BY b.pi_date DESC, o.sl_no DESC`,
      params
    ),
    query<PaymentLine>(
      `SELECT o.id AS order_id, o.so_no, o.client_name, a.payment_status, ${ymd("a.payment_confirmed_date")} AS confirmed_on,
              a.amount_received::text AS amount_received, a.balance_of_payment::text AS balance,
              COALESCE(NULLIF(o.order_currency, ''), 'INR') AS currency
         FROM order_accounts a
         JOIN orders o ON o.id = a.order_id
        WHERE a.order_id = ANY($1::uuid[]) AND a.payment_confirmed_date BETWEEN $2::date AND $3::date
        ORDER BY a.payment_confirmed_date DESC, o.sl_no DESC`,
      params
    ),
    query<{ order_id: string; d: string }>(
      `SELECT DISTINCT it.order_id, ${ymd("rl.ready_date")} AS d
         FROM order_ready_lots rl JOIN order_items it ON it.id = rl.item_id
        WHERE it.order_id = ANY($1::uuid[]) AND rl.ready_date BETWEEN $2::date AND $3::date`,
      [ids, filter.from, readyTo]
    ),
    query<{ order_id: string; d: string }>(
      `SELECT DISTINCT order_id, ${ymd("d")} AS d FROM (
         SELECT it.order_id, rl.packed_date AS d FROM order_ready_lots rl JOIN order_items it ON it.id = rl.item_id
          WHERE it.order_id = ANY($1::uuid[])
         UNION ALL
         SELECT it.order_id, ad.actual_packing_date FROM order_assembly_dispatch ad JOIN order_items it ON it.id = ad.item_id
          WHERE it.order_id = ANY($1::uuid[])) p
        WHERE d BETWEEN $2::date AND $3::date`,
      params
    ),
    query<{ order_id: string; d: string }>(
      `SELECT DISTINCT i.order_id, ${ymd("COALESCE(i.delivery_date, i.invoice_date, i.challan_date)")} AS d
         FROM order_invoices i
        WHERE i.order_id = ANY($1::uuid[])
          AND COALESCE(i.delivery_date, i.invoice_date, i.challan_date) BETWEEN $2::date AND $3::date`,
      params
    ),
  ]);

  const created = rows.filter((r) => !!r.so_date && r.so_date >= filter.from && r.so_date <= filter.to);

  // Week by week; a range longer than four months reads better by month.
  const bucketBy: "week" | "month" = daysBetween(filter.from, filter.to) > 120 ? "month" : "week";
  const keyOf = (d: string) => (bucketBy === "week" ? weekOf(d) : d.slice(0, 7));
  const keys: string[] = [];
  for (let d = filter.from; d <= filter.to; d = bucketBy === "week" ? weekOfNext(d) : monthNext(d)) {
    const k = keyOf(d);
    if (!keys.includes(k)) keys.push(k);
  }
  const buckets = new Map<string, ActivityBucket>(
    keys.map((k) => [
      k,
      {
        label: bucketBy === "week" ? shortDate(k, false) : shortMonth(k),
        created: 0,
        pis: 0,
        ready: 0,
        packed: 0,
        dispatched: 0,
      },
    ])
  );
  const bump = (d: string | null, field: keyof Omit<ActivityBucket, "label">, seen?: Set<string>, id?: string) => {
    if (!d) return;
    const k = keyOf(d);
    const b = buckets.get(k);
    if (!b) return;
    // An SO counts once per bucket for the department.
    if (seen && id) {
      const tag = `${k}|${id}`;
      if (seen.has(tag)) return;
      seen.add(tag);
    }
    b[field] += 1;
  };
  for (const r of created) bump(r.so_date, "created");
  for (const p of pis.rows) bump(p.pi_date, "pis");
  const seenReady = new Set<string>();
  for (const e of ready.rows) bump(e.d, "ready", seenReady, e.order_id);
  const seenPacked = new Set<string>();
  for (const e of packed.rows) bump(e.d, "packed", seenPacked, e.order_id);
  const seenDispatched = new Set<string>();
  for (const e of dispatched.rows) bump(e.d, "dispatched", seenDispatched, e.order_id);

  const toPack = rows.filter((r) => r.stage === "to_pack");
  const band = (lo: number, hi: number) =>
    toPack.filter((r) => r.waiting_days !== null && r.waiting_days >= lo && r.waiting_days <= hi).length;
  const ageing: SparesReport["ageing"] = [
    { label: "0–3 days", count: band(0, 3), tone: "ok" },
    { label: "4–7 days", count: band(4, 7), tone: "warn" },
    { label: "8–15 days", count: band(8, 15), tone: "warn" },
    { label: "Over 15 days", count: band(16, 100000), tone: "late" },
    {
      label: "Ready date ahead",
      count: toPack.filter((r) => r.waiting_since !== null && r.waiting_since > today).length,
      tone: "none",
    },
    { label: "No ready date", count: toPack.filter((r) => r.waiting_since === null).length, tone: "none" },
  ];

  return {
    filter,
    today,
    rows,
    options,
    activity: {
      created,
      pis: pis.rows,
      payments: payments.rows,
      readySos: new Set(ready.rows.map((e) => e.order_id)).size,
      packedSos: new Set(packed.rows.map((e) => e.order_id)).size,
      dispatchedSos: new Set(dispatched.rows.map((e) => e.order_id)).size,
      buckets: [...buckets.values()],
      bucketBy,
    },
    ageing,
  };
}

function weekOfNext(date: string): string {
  const d = new Date(`${weekOf(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

function monthNext(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** SOs per value of a status, in the order the values are listed. */
export function countBy(rows: SpareSoRow[], key: "planning_status" | "assembly_status" | "dispatch_status", order: string[]) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r[key], (counts.get(r[key]) ?? 0) + 1);
  return [...order.filter((v) => counts.has(v)), ...[...counts.keys()].filter((v) => !order.includes(v))].map(
    (v) => ({ label: v, count: counts.get(v) ?? 0 })
  );
}

/** The headline of where the SOs stand: the pipeline and what is held up. */
export function summaryOf(rows: SpareSoRow[]) {
  const ready = rows.filter((r) => r.planning_status === "Fully ready" || r.planning_status === "Partial ready").length;
  const packed = rows.filter(
    (r) => r.assembly_status === "Fully packed" || r.assembly_status === "Partially packed" || r.stage === "dispatched"
  ).length;
  const dispatched = rows.filter((r) => r.dispatch_status === "Fully dispatch").length;
  return {
    pipeline: [
      { label: "Active SOs", count: rows.length },
      { label: "Ready (Planning)", count: ready },
      { label: "Packed", count: packed },
      { label: "Fully dispatched", count: dispatched },
    ],
    toPack: rows.filter((r) => r.stage === "to_pack").length,
    packedWaiting: rows.filter((r) => r.stage === "packed").length,
    notReady: rows.filter((r) => r.stage === "not_ready").length,
    packOverdue: rows.filter((r) => r.pack_overdue > 0 && r.stage !== "dispatched").length,
    lotDispatched: rows.filter((r) => r.dispatch_status === "LOT dispatch").length,
  };
}
