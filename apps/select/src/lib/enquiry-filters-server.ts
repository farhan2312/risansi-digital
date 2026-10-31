// SQL for the shared enquiry filters (lib/enquiry-filters.ts). Every condition
// is on `projects`, so it works in a projects-only query and in one that joins
// projects to its tags. Server-only.
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "./db";
import { enquiryTags, projects } from "./db/schema";
import type { EnquiryFilterOptions, EnquiryFilters } from "./enquiry-filters";

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

const same = (col: AnyColumn, v: string) => sql`lower(trim(${col})) = lower(${v.trim()})`;

export function enquiryFilterSql(f: EnquiryFilters): SQL[] {
  const out: SQL[] = [];
  // Every word of the client search must match the name or the code.
  for (const w of (f.client ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
    const like = `%${esc(w)}%`;
    out.push(sql`(${projects.name} ILIKE ${like} OR ${projects.clientCode} ILIKE ${like})`);
  }
  if (f.primaryRep) out.push(same(projects.clientPrimaryRep, f.primaryRep));
  // Secondary reps are stored as "A, B, C": match one whole name.
  if (f.secondaryRep)
    out.push(sql`(', ' || regexp_replace(lower(coalesce(${projects.clientSecondaryReps}, '')), '\\s*,\\s*', ', ', 'g') || ',') LIKE ${`%, ${esc(f.secondaryRep.trim().toLowerCase())},%`}`);
  if (f.zone) out.push(same(projects.clientZone, f.zone));
  if (f.market) out.push(same(projects.clientMarketType, f.market));
  if (f.industry) out.push(same(projects.industry, f.industry));
  if (f.status) out.push(sql`${enquiryStatusSql} = ${f.status}`);
  return out;
}

/** Distinct non-blank values for the filter dropdowns. */
export async function enquiryFilterOptions(): Promise<EnquiryFilterOptions> {
  const distinct = async (col: AnyColumn) => {
    const rows = await db.execute<{ v: string }>(
      sql`select distinct trim(${col}) as v from ${projects} where nullif(trim(${col}), '') is not null order by 1`,
    );
    return rows.rows.map((r) => r.v);
  };
  const [primaryReps, secondaryRaw, zones, markets, industries] = await Promise.all([
    distinct(projects.clientPrimaryRep),
    distinct(projects.clientSecondaryReps),
    distinct(projects.clientZone),
    distinct(projects.clientMarketType),
    distinct(projects.industry),
  ]);
  const secondaryReps = [...new Set(secondaryRaw.flatMap((s) => s.split(",").map((x) => x.trim()).filter(Boolean)))].sort((a, b) =>
    a.localeCompare(b),
  );
  return { primaryReps, secondaryReps, zones, markets, industries };
}
