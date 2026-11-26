import "server-only";
import { query } from "@/lib/db";

/**
 * Drawing saves an EC's GAD, Performance Curve or part drawings only once its
 * SO has an Expected Readiness Date: the error to show, or null when it has one.
 * A revision's own EC wins over the one passed, when its id is given.
 */
export async function readinessMissingForItem(itemId: string, revisionId?: string): Promise<string | null> {
  const r = await query<{ has: boolean }>(
    `SELECT o.drg_readiness_date IS NOT NULL AS has
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE i.id = COALESCE((SELECT r.item_id FROM order_drawing_revisions r WHERE r.id::text = $2), $1::uuid)`,
    [itemId, revisionId ?? null]
  );
  if (!r.rows[0]) return null;
  return r.rows[0].has ? null : "Set the SO's Expected DRG Readiness Date first (Drawing page, Expected DRG Readiness Date column).";
}
