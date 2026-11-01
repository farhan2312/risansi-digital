// Parsing the enquiry form's order type and client details (POST / PATCH
// /api/projects). Client-safe.
import { ORDER_SUBTYPES, defaultSubtype, type OrderSubtype, type OrderType } from "./roles";

/** "pump" | "spare"; missing = "pump"; anything else = null (invalid). */
export function orderTypeFrom(v: unknown): OrderType | null {
  if (v === undefined || v === null || v === "") return "pump";
  const s = String(v).trim().toLowerCase();
  return s === "pump" || s === "spare" ? s : null;
}

/** The subtype for that order type; missing = its default (PCP / Spare);
 *  one that does not belong to the type = null (invalid). */
export function orderSubtypeFrom(type: OrderType, v: unknown): OrderSubtype | null {
  if (v === undefined || v === null || v === "") return defaultSubtype(type);
  const s = String(v).trim().toLowerCase();
  return ORDER_SUBTYPES[type].find((o) => o.value === s)?.value ?? null;
}

const text = (v: unknown, max: number): string | null => {
  const s = v === undefined || v === null ? "" : String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** The client's reps, market type and zone as sent (only the keys present,
 *  so a PATCH leaves the rest alone). */
export function clientDetailsFrom(body: Record<string, unknown>): {
  clientPrimaryRep?: string | null;
  clientSecondaryReps?: string | null;
  clientMarketType?: string | null;
  clientZone?: string | null;
} {
  const out: ReturnType<typeof clientDetailsFrom> = {};
  if ("clientPrimaryRep" in body) out.clientPrimaryRep = text(body.clientPrimaryRep, 255);
  if ("clientSecondaryReps" in body) out.clientSecondaryReps = text(body.clientSecondaryReps, 2000);
  if ("clientMarketType" in body) out.clientMarketType = text(body.clientMarketType, 50);
  if ("clientZone" in body) out.clientZone = text(body.clientZone, 50);
  return out;
}
