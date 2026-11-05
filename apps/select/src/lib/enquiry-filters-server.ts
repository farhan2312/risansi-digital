// SQL for the shared enquiry filters (lib/enquiry-filters.ts). Every condition
// is on `projects`, so it works in a projects-only query and in one that joins
// projects to its tags. Server-only.
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "./db";
import { commercialTagPrice, enquiryTags, projects, quotation } from "./db/schema";
import { filterKey, type EnquiryFilterOptions, type EnquiryFilters } from "./enquiry-filters";

const esc = (v: string) => v.replace(/([\\%_])/g, "\\$1");

/** A spare order has no technical step: Completed when its quotation is sent to the
 *  client, In Progress once it is generated, otherwise Pending. */
const SPARE_STATUS = sql`CASE
      WHEN projects.sent_to_client_at IS NOT NULL THEN 'Completed'
      WHEN EXISTS (SELECT 1 FROM ${quotation} q WHERE q.project_id = projects.id) THEN 'In Progress'
      ELSE 'Pending'
    END`;

/** Technical status, automatic: Completed when every tag is Completed, a
 *  quotation is generated and the Technical Data Sheets are sent to operation
 *  (app/api/enquiry-document/versions), Pending when every tag is Pending, otherwise In
 *  Progress. Outer columns written as projects.* - on a single-table select
 *  Drizzle renders ${projects.id} bare, which inside this subquery would mean
 *  the tag's id. */
export const technicalStatusAutoSql = sql<string>`(
  SELECT CASE
    WHEN projects.order_type = 'spare' THEN ${SPARE_STATUS}
    WHEN COUNT(*) = 0 THEN coalesce(projects.status, 'Pending')
    WHEN COUNT(*) FILTER (WHERE t.status = 'Completed') = COUNT(*)
         AND EXISTS (SELECT 1 FROM ${quotation} q WHERE q.project_id = projects.id)
         AND projects.sent_to_operation_at IS NOT NULL THEN 'Completed'
    WHEN COUNT(*) FILTER (WHERE t.status = 'Pending') = COUNT(*) THEN 'Pending'
    ELSE 'In Progress'
  END
  FROM ${enquiryTags} t WHERE t.project_id = projects.id
)`;

/** The status lists and counts go by: the Technical status (a spare's only status
 *  is its Commercial one): what was picked on the Edit form, else automatic. */
export const enquiryStatusSql = sql<string>`coalesce(CASE WHEN projects.order_type = 'spare' THEN projects.commercial_status_override ELSE projects.technical_status_override END, ${technicalStatusAutoSql})`;

/** Commercial status, automatic: Completed once the Technical status is Completed (or Sent to client),
 *  every tag has a saved P&A price and the quotations are sent to operation
 *  (app/api/quotations/[id]/send; sent_to_client_at keeps its old name), In Progress once any tag's prices are saved,
 *  otherwise Pending. A send from before this version began is a Technical only
 *  version carrying it: its commercial side hasn't changed, so Technical isn't
 *  waited for. */
export const commercialStatusAutoSql = sql<string>`(
  SELECT CASE
    WHEN projects.order_type = 'spare' THEN ${SPARE_STATUS}
    WHEN COUNT(*) > 0 AND COUNT(k.pa_price) = COUNT(*)
         AND projects.sent_to_client_at IS NOT NULL
         AND (projects.sent_to_client_at < projects.created_at OR ${enquiryStatusSql} IN ('Completed', 'Sent to client')) THEN 'Completed'
    WHEN COUNT(k.tag_id) > 0 THEN 'In Progress'
    ELSE 'Pending'
  END
  FROM ${enquiryTags} t LEFT JOIN ${commercialTagPrice} k ON k.tag_id = t.id
  WHERE t.project_id = projects.id
)`;

/** The status shown: what was picked on the Edit form, else the automatic one. Not Quoted
 *  and Sent to client are only ever picked, never automatic. */
export const commercialStatusSql = sql<string>`coalesce(projects.commercial_status_override, ${commercialStatusAutoSql})`;

/** The automatic completion day (YYYY-MM-DD, IST): when the sheets went to
 *  operation, and when the quotations went to the client. */
const technicalDayAutoSql = sql<string | null>`to_char(projects.sent_to_operation_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
const commercialDayAutoSql = sql<string | null>`to_char(projects.sent_to_client_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;

/** For a select on projects, with enquiryStatusFields on its rows. */
export const enquiryStatusColumns = {
  technicalAuto: technicalStatusAutoSql,
  commercialAuto: commercialStatusAutoSql,
  technicalDayAuto: technicalDayAutoSql,
  commercialDayAuto: commercialDayAutoSql,
};

type StatusAutos = { technicalAuto: string; commercialAuto: string; technicalDayAuto: string | null; commercialDayAuto: string | null };

/** The statuses and dates shown: what was changed on the Edit form, else automatic. */
export const enquiryStatusFields = (
  p: { orderType: string; technicalStatusOverride: string | null; commercialStatusOverride: string | null; completedOn: string | null; commercialCompletedOn: string | null },
  auto: StatusAutos,
) => {
  const commercial = p.commercialStatusOverride ?? auto.commercialAuto;
  const commercialDay = commercial === "Completed" ? (p.commercialCompletedOn ?? auto.commercialDayAuto) : null;
  // A spare's only status is its Commercial one.
  if (p.orderType === "spare") return { status: commercial, completed_on: commercialDay, commercial_status: commercial, commercial_completed_on: commercialDay };
  const status = p.technicalStatusOverride ?? auto.technicalAuto;
  return {
    status,
    completed_on: status === "Completed" ? (p.completedOn ?? auto.technicalDayAuto) : null,
    commercial_status: commercial,
    commercial_completed_on: commercialDay,
  };
};

/** A Save Version changes what was reviewed, so it has to be reviewed, sent and mailed again. */
export const REVIEW_CLEARED = { reviewedAt: null, reviewedBy: null, releasedToOperationAt: null, releasedToOperationBy: null, mailedAt: null, mailedBy: null };

/** A value as filterKey() sees it: lower case, letters and digits only. */
const keyOf = (expr: SQL | AnyColumn) => sql`regexp_replace(lower(coalesce(${expr}, '')), '[^a-z0-9]', '', 'g')`;

const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

/** The column matches any of the picked values, whatever their spelling. */
const anyOf = (col: AnyColumn, picked: string[]): SQL | null => {
  const keys = [...new Set(picked.map(filterKey).filter(Boolean))];
  return keys.length ? sql`${keyOf(col)} IN (${list(keys)})` : null;
};

export function enquiryFilterSql(f: EnquiryFilters): SQL[] {
  // Lists and counts hold each enquiry once, as its latest version (written as
  // projects.* for the same reason as enquiryStatusSql).
  const out: SQL[] = [sql`projects.is_latest`];
  const push = (c: SQL | null) => c && out.push(c);
  // Every word of the client search must match the name or the code.
  for (const w of (f.client ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
    const like = `%${esc(w)}%`;
    out.push(sql`(${projects.name} ILIKE ${like} OR ${projects.clientCode} ILIKE ${like})`);
  }
  push(anyOf(projects.orderType, f.orderType ?? []));
  // Pump type and spare type both pick from order_subtype; picking some of
  // each means either (PCP pumps or retrofit spares), not both at once.
  push(anyOf(projects.orderSubtype, [...(f.pumpType ?? []), ...(f.spareType ?? [])]));
  push(anyOf(projects.clientPrimaryRep, f.primaryRep ?? []));
  // Secondary reps are stored as "A, B, C": any one of them matching counts.
  const sec = [...new Set((f.secondaryRep ?? []).map(filterKey).filter(Boolean))];
  if (sec.length)
    out.push(
      sql`EXISTS (SELECT 1 FROM unnest(string_to_array(${projects.clientSecondaryReps}, ',')) AS s(name) WHERE ${keyOf(sql`s.name`)} IN (${list(sec)}))`,
    );
  push(anyOf(projects.clientZone, f.zone ?? []));
  push(anyOf(projects.clientMarketType, f.market ?? []));
  push(anyOf(projects.industry, f.industry ?? []));
  // A spare has no Technical status: it goes by the Commercial filter alone.
  if (f.status?.length) out.push(sql`(projects.order_type IS DISTINCT FROM 'spare' AND ${enquiryStatusSql} IN (${list(f.status)}))`);
  if (f.commercialStatus?.length) out.push(sql`${commercialStatusSql} IN (${list(f.commercialStatus)})`);
  return out;
}

/** One entry per value (spellings that differ only in case, spaces or
 *  punctuation count as one), shown in its most used spelling. */
function canonical(counts: Map<string, number>): string[] {
  const best = new Map<string, { label: string; n: number }>();
  for (const [label, n] of counts) {
    const k = filterKey(label);
    if (!k) continue;
    const cur = best.get(k);
    if (!cur) best.set(k, { label, n });
    else {
      // The spelling used most wins (n is that spelling's own count).
      const label2 = n > cur.n ? label : cur.label;
      best.set(k, { label: label2, n: Math.max(n, cur.n) });
    }
  }
  return [...best.values()].map((b) => b.label).sort((a, b) => a.localeCompare(b));
}

/** Distinct values for the filter dropdowns. */
export async function enquiryFilterOptions(): Promise<EnquiryFilterOptions> {
  const counted = async (col: AnyColumn) => {
    const rows = await db.execute<{ v: string; n: number }>(
      sql`select trim(${col}) as v, count(*)::int as n from ${projects} where nullif(trim(${col}), '') is not null group by 1`,
    );
    return new Map(rows.rows.map((r) => [r.v, Number(r.n)]));
  };
  const [primary, secondaryRaw, zones, markets, industries] = await Promise.all([
    counted(projects.clientPrimaryRep),
    counted(projects.clientSecondaryReps),
    counted(projects.clientZone),
    counted(projects.clientMarketType),
    counted(projects.industry),
  ]);
  const secondary = new Map<string, number>();
  for (const [raw, n] of secondaryRaw)
    for (const name of raw.split(",").map((x) => x.trim()).filter(Boolean)) secondary.set(name, (secondary.get(name) ?? 0) + n);
  return {
    primaryReps: canonical(primary),
    secondaryReps: canonical(secondary),
    zones: canonical(zones),
    markets: canonical(markets),
    industries: canonical(industries),
  };
}
