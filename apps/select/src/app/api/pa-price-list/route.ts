import { asc } from "drizzle-orm";

import { json } from "@/lib/api";
import { db } from "@/lib/db";
import { paPriceLevel, paPriceList, paRubberAddon } from "@/lib/db/schema";
import type { PaLevelKey, PaPriceData } from "@/lib/pa-price";

export const dynamic = "force-dynamic";

// GET /api/pa-price-list — the L1–L4 P&A price lists (levels, model rows with
// each list's MOC columns, Viton/HNBR add-ons) for the Commercial Summary's
// P&A price suggestion. Small (≈ 50 rows), loaded once per page.

const PRICE_COLS = [
  "l1Abbn", "l1Bbbn", "l1Accn", "l1Cccn",
  "l2Abbn", "l2Bbbn", "l2Cccn",
  "l3Abbn", "l3Bbbn", "l3Accn", "l3Cccn",
  "l4Abbn", "l4Bbbn", "l4Cccn",
] as const;
/** "l1Abbn" → "l1_abbn" (the key lib/pa-price reads). */
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const num = (v: string | null) => (v === null ? null : Number(v));

export async function GET() {
  const [levels, rows, addons] = await Promise.all([
    db.select().from(paPriceLevel).orderBy(asc(paPriceLevel.level)),
    db.select().from(paPriceList).orderBy(asc(paPriceList.srNo)),
    db.select().from(paRubberAddon).orderBy(asc(paRubberAddon.amount)),
  ]);
  const data: PaPriceData = {
    levels: levels.map((l) => ({ level: l.level as PaLevelKey, title: l.title, dateText: l.dateText, listDate: l.listDate })),
    rows: rows.map((r) => ({
      srNo: r.srNo,
      pumpModelNo: r.pumpModelNo,
      prices: Object.fromEntries(PRICE_COLS.map((k) => [snake(k), num(r[k])])),
    })),
    addons: addons.map((a) => ({ pumpModel: a.pumpModel, amount: Number(a.amount) })),
  };
  return json(data);
}
