// Belt-child parsing shared by POST (create parent+children) and PATCH
// (replace-all-children on the existing parent). Values arrive as raw strings
// from the wizard form's <input> elements — parse to the DB-facing types the
// pulley_belt_option table expects (targetRpm required INTEGER; the rest
// optional NUMERIC, stored as strings via drizzle-orm/pg).

import type { pulleyBeltOption } from "@/lib/db/schema";

export type BeltInsert = Omit<
  typeof pulleyBeltOption.$inferInsert,
  "id" | "pulleyMotorOptionId"
>;

function numOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isNaN(n) ? null : String(n);
}

function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

/** Parses a raw `belts` array from the request body. Returns either a
 * validated list of insertable rows OR an error message (rejects if any row
 * is missing its required targetRpm). Callers pass this straight into
 * db.insert(pulleyBeltOption).values(...). */
export function parseBeltRows(
  raw: unknown,
): { belts: BeltInsert[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "'belts' must be an array" };
  }
  const belts: BeltInsert[] = [];
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (b === null || typeof b !== "object") {
      return { error: `belts[${i}] must be an object` };
    }
    const row = b as Record<string, unknown>;
    const targetRpm = intOrNull(row.targetRpm);
    if (targetRpm === null) {
      return { error: `belts[${i}].targetRpm is required and must be an integer` };
    }
    belts.push({
      targetRpm,
      pmpPulley: numOrNull(row.pmpPulley),
      mtrPulley: numOrNull(row.mtrPulley),
      actualRpm: numOrNull(row.actualRpm),
      centerDistance: numOrNull(row.centerDistance),
      vBelt: numOrNull(row.vBelt),
    });
  }
  return { belts };
}
