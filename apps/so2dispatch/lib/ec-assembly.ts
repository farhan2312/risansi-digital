import "server-only";
// How far Assembly has got on each pump EC, for a department that waits on it
// (Quality): its quantity, what Planning has ready, how many are assembled
// and the last day any were; and its SO's base plate, lot by lot.

import { query } from "@/lib/db";
import { alignmentLotsSql, basePlateSql, basePlateStepsSql } from "@/lib/assembly";

export type EcAssembly = { qty: number; ready: number; assembled: number; lastAssembled: string | null; alignment: unknown };

/** Each pump EC's assembly, by EC id. A Spare EC has none and is left out. */
export async function listEcAssembly(itemIds: string[]): Promise<Record<string, EcAssembly>> {
  if (!itemIds.length) return {};
  const r = await query<{ id: string; qty: number | null; ready: number | null; assembled: number; last: string | null; alignment: unknown }>(
    `SELECT it.id, it.quantity AS qty,
            (SELECT pl.ready_qty FROM order_planning pl WHERE pl.item_id = it.id) AS ready,
            COALESCE((SELECT sum(la.qty) FROM order_lot_assembly la
                       WHERE la.item_id = it.id AND la.assembled_date IS NOT NULL), 0)::int AS assembled,
            (SELECT to_char(max(la.assembled_date), 'YYYY-MM-DD') FROM order_lot_assembly la
              WHERE la.item_id = it.id AND la.assembled_date IS NOT NULL) AS last,
            -- The SO's base plate and its alignment lots, as Assembly & Packing has them.
            (SELECT jsonb_build_object('base_plate', ${basePlateSql("oa")}, 'base_plate_status', oa.base_plate_status,
                                       'base_plate_date', to_char(oa.base_plate_date, 'YYYY-MM-DD'),
                                       'base_plate_steps', ${basePlateStepsSql("oa")}, 'lots', ${alignmentLotsSql("oa")})
               FROM orders oa WHERE oa.id = it.order_id) AS alignment
       FROM order_items it
      WHERE it.id = ANY($1::uuid[]) AND it.item_type IN ('Pump', 'ROLB')`,
    [itemIds]
  );
  return Object.fromEntries(
    r.rows.map((x) => [x.id, { qty: Number(x.qty ?? 0), ready: Number(x.ready ?? 0), assembled: x.assembled, lastAssembled: x.last, alignment: x.alignment }])
  );
}
