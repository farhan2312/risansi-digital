// SQL for the shared enquiry filters (lib/enquiry-filters.ts). Every condition
// is on `projects`, so it works in a projects-only query and in one that joins
// projects to its tags. Server-only.
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "./db";
import { enquiryTags, projects } from "./db/schema";
import { filterKey, type EnquiryFilterOptions, type EnquiryFilters } from "./enquiry-filters";

const esc = (v: string) => v.replace(/([\\%_])/g, "\\$1");

/** Same rollup as the Enquiries list: all tags Completed -> Completed, all
 *  Pending -> Pending, otherwise In Progress. Outer columns written as
 *  projects.* - on a single-table select Drizzle renders ${projects.id} bare,
 *  which inside this subquery would mean the tag's id. */
export const enquiryStatusSql = sql<string>`(
  SELECT CASE
    WHEN COUNT(*) = 0 THEN coalesce(projects.status, 'Pending')
    WHEN COUNT(*) FILTER (WHERE t.status = 'Completed') = COUNT(*) THEN 'Completed'
    WHEN COUNT(*) FILTER (WHERE t.status = 'Pending') = COUNT(*) THEN 'Pending'
    ELSE 'In Progress'
  END
  FROM ${enquiryTags} t WHERE t.project_id = projects.id
)`;

/** A value as filterKey() sees it: lower case, letters and digits only. */
const keyOf = (expr: SQL | AnyColumn) => sql`regexp_replace(lower(coalesce(${expr}, '')), '[^a-z0-9]', '', 'g')`;

const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

/** The column matches any of the picked values, whatever their spelling. */
const anyOf = (col: AnyColumn, picked: string[]): SQL | null => {
  const keys = [...new Set(picked.map(filterKey).filter(Boolean))];
  return keys.length ? sql`${keyOf(col)} IN (${list(keys)})` : null;
};

export function enquiryFilterSql(f: EnquiryFilters): SQL[] {
  const out: SQL[] = [];
  const push = (c: SQL | null) => c && out.push(c);
  // Every word of the client search must match the name or the code.
  for (const w of (f.client ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
    const like = `%${esc(w)}%`;
    out.push(sql`(${projects.name} ILIKE ${like} OR ${projects.clientCode} ILIKE ${like})`);
  }
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
  if (f.status?.length) out.push(sql`${enquiryStatusSql} IN (${list(f.status)})`);
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
