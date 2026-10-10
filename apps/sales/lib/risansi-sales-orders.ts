// Sales Orders against a Won opportunity. Pure helpers shared by the server
// actions and the KPI/status readers. Values are CRORES on the wire to the DB
// (matching opportunities.final_value_cr); the forms submit rupees, converted
// here. See migration 0029.

export interface SoInput { so_number: string; so_date: string; so_value_cr: number }

export interface SalesOrder {
  id: number;
  opportunity_id: number;
  so_number: string;
  so_date: string;          // ISO date
  so_value_cr: number;      // crores
  created_by: string | null;
}

const CR = 10_000_000;

/**
 * Parse the `sales_orders_json` a Won form submits: an array of
 * { so_number, so_date, so_value_inr }. Fully-blank rows are dropped; a
 * partially-filled row (or a non-positive value) is an error, because SO
 * Number, Date and Value are all mandatory per row. Returns rows in CRORES.
 */
export function parseSalesOrdersJson(raw: unknown): { rows: SoInput[]; error: string | null } {
  let arr: unknown[] = [];
  try { const p = JSON.parse(typeof raw === 'string' ? raw : '[]'); if (Array.isArray(p)) arr = p; } catch { /* ignore */ }

  const rows: SoInput[] = [];
  for (const it of arr) {
    const o = (it ?? {}) as Record<string, unknown>;
    const num  = String(o.so_number ?? '').trim();
    const date = String(o.so_date ?? '').trim();
    const inr  = parseFloat(String(o.so_value_inr ?? o.so_value ?? '').replace(/[^0-9.\-]/g, ''));
    const hasInr = Number.isFinite(inr);

    if (!num && !date && !hasInr) continue;                 // skip an untouched row
    if (!num || !date || !hasInr || inr <= 0) {
      return { rows: [], error: 'Every Sales Order needs an SO Number, an SO Date and an SO Value greater than zero.' };
    }
    // A real calendar date (YYYY-MM-DD) — a garbage date would throw 22007 on insert.
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) {
      return { rows: [], error: 'Each Sales Order needs a valid date (YYYY-MM-DD).' };
    }
    // Keep within so_value_cr numeric(14,7) (max ~₹1,00,00,00,00,00,000) so an
    // absurd value can't throw a numeric overflow mid-insert.
    const cr = inr / CR;
    if (cr >= 9_999_999) {
      return { rows: [], error: 'That Sales Order value is unrealistically large — please check it.' };
    }
    rows.push({ so_number: num, so_date: date, so_value_cr: cr });
  }
  return { rows, error: null };
}

/** A single rupee value → crores (for the add-one-SO action). */
export function inrToCr(inr: number): number { return inr / CR; }

/**
 * Won sub-status. Open while the SO values don't yet cover the final value;
 * Closed once they reach or exceed it (over-delivery still counts as Closed).
 * A Won with no final value can never be "covered", so it stays Open.
 */
export function wonSubStatus(finalCr: number | null | undefined, soSumCr: number): 'Open' | 'Closed' {
  if (finalCr == null || finalCr <= 0) return 'Open';
  return soSumCr >= finalCr ? 'Closed' : 'Open';
}

/** Un-fulfilled ("order in hand") value in crores: final minus SO'd, floored at 0. */
export function orderInHandCr(finalCr: number | null | undefined, soSumCr: number): number {
  if (finalCr == null || finalCr <= 0) return 0;
  return Math.max(0, finalCr - soSumCr);
}
