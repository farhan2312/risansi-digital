import "server-only";
// Where each SO stands on a dashboard, read off the Orders page's own cards:
// the first card (in the order given) whose condition the SO meets names its
// stage. The cards' SQL is the one source, so a stage counts exactly what its
// card does wherever the cards do not overlap.

import { query } from "@/lib/db";
import type { KpiCardDef } from "@/lib/kpis";

export async function stageByCards<S extends string>(
  ids: string[],
  cards: KpiCardDef[],
  order: readonly (readonly [key: string, stage: S])[]
): Promise<Map<string, S>> {
  const picks = order.flatMap(([key, stage]) => {
    const sql = cards.find((c) => c.key === key)?.sql;
    return sql ? [{ sql, stage }] : [];
  });
  const out = new Map<string, S>();
  if (!ids.length || !picks.length) return out;
  const r = await query<{ id: string; stage: S | null }>(
    `SELECT o.id, CASE ${picks.map((p, i) => `WHEN (${p.sql}) THEN $${i + 2}::text`).join(" ")} END AS stage
       FROM orders o WHERE o.id = ANY($1::uuid[])`,
    [ids, ...picks.map((p) => p.stage)]
  );
  for (const x of r.rows) if (x.stage) out.set(x.id, x.stage);
  return out;
}
