// Customer Purchase Orders against a Won opportunity. A free-standing list (no
// coverage / Open-Closed maths, unlike Sales Orders). Values are CRORES on the
// wire to the DB; the form submits rupees, converted here. See migration 0030.

export interface PoInput { po_number: string; po_date: string; po_value_cr: number }

export interface PurchaseOrder {
  id: number;
  opportunity_id: number;
  po_number: string;
  po_date: string;          // ISO date
  po_value_cr: number;      // crores
  created_by: string | null;
}

const CR = 10_000_000;

/** A single rupee value → crores. */
export function poInrToCr(inr: number): number { return inr / CR; }
