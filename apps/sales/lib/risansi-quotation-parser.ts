// Rule-based parser for Risansi PDF quotations. Given the flattened text of a
// quote (from unpdf's extractText), it best-effort recovers the quote-level
// attributes and a list of quoted line items. It never guesses wildly — fields
// it can't read confidently are left null, and the caller only fills blanks.
//
// The layouts differ a lot (pump spec sheets vs. tabular spare/commercial
// quotes, INR vs. USD), and unpdf reads text in content-stream order rather
// than visual order — so in the templated "CUSTOMER" quotes the header values
// land detached from their labels, in label order, around the quote number.
// That's why the RIL/QT/… quote number is the anchor rather than "label: value"
// adjacency. Validated against 5 real quotes of every shape.

export interface ParsedQuoteMeta {
  quote_ref?: string;
  quote_date?: string;         // yyyy-mm-dd
  enquiry_no?: string;
  enquiry_date?: string;       // yyyy-mm-dd
  product_type?: string;       // PCP | MMP | SPARE | OBL
  market?: string;             // DOMESTIC | EXPORT
  ril_rep?: string;
  qtr?: string;                // Q1..Q4 (Indian FY)
  offer_value_inr?: number;
}

export interface ParsedQuoteItem {
  pump_model: string | null;
  pump_qty: number | null;
  pump_speed: string | null;
  geared_motor_detail: string | null;
  motor_price: number | null;
  gearbox_vbelt_price: number | null;
  offer_value_inr: number | null;
  detailed_specifications: string | null;
}

export interface ParsedQuote {
  meta: ParsedQuoteMeta;
  items: ParsedQuoteItem[];
}

const num = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/[, ]/g, ''));
  return Number.isFinite(v) ? v : null;
};

// dd-mm-yyyy -> yyyy-mm-dd (for <input type=date>)
const toISO = (dmy: string): string | null => {
  const m = String(dmy).match(/(\d{2})-(\d{2})-(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// Indian financial-year quarter from an ISO date (Apr-Jun = Q1 … Jan-Mar = Q4).
const qtrFromISO = (iso: string | null): string | null => {
  const m = iso && iso.match(/^\d{4}-(\d{2})/);
  if (!m) return null;
  const mo = parseInt(m[1], 10);
  if (mo >= 4 && mo <= 6) return 'Q1';
  if (mo >= 7 && mo <= 9) return 'Q2';
  if (mo >= 10 && mo <= 12) return 'Q3';
  return 'Q4';
};

// Maps the code in a quote number to a product type. OBL in a quote ref means
// the type spelled OLB — the column's old value was a transposition, corrected
// in migration 0061, and this map fed it.
const CAT_MAP: Record<string, string> = {
  SPR: 'SPARE', SPARE: 'SPARE', SPARES: 'SPARE',
  PCP: 'PCP', MMP: 'MMP', RBL: 'RBL', OBL: 'OLB', OLB: 'OLB',
  SERVICE: 'SERVICE', OTHER: 'OTHER',
};

export function parseQuotationText(rawText: string): ParsedQuote {
  const t = String(rawText || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const meta: ParsedQuoteMeta = {};
  const items: ParsedQuoteItem[] = [];
  if (!t) return { meta, items };

  const usd = /\bU[DS]D\b|\bin UDS\b|\bin USD\b/i.test(t);

  // ---- Quote number: layout-independent anchor ----
  // RIL/QT/<rep>/<FY>/<cat>/<num>[_V-n]  (tolerate stray spaces around slashes)
  const qnRe = /RIL\s*\/\s*QT\s*\/\s*([A-Z0-9_]+)\s*\/\s*(\d{2}-\d{2})\s*\/\s*([A-Za-z]+)\s*\/\s*(\d+)\s*((?:[_ ]\s*V-?\s*\d+)?)/i;
  const qn = t.match(qnRe);
  let enqNoDetached: string | undefined;
  let enqDateDetached: string | null | undefined;
  if (qn && qn.index != null) {
    const rep = qn[1];
    const fy = qn[2];
    const cat = qn[3].toUpperCase();
    const no = qn[4];
    const ver = (qn[5] || '').replace(/\s+/g, '').replace(/^_/, '');
    meta.quote_ref = `RIL/QT/${rep}/${fy}/${cat}/${no}${ver ? '_' + ver : ''}`;
    if (CAT_MAP[cat]) meta.product_type = CAT_MAP[cat];
    meta.ril_rep = rep.replace(/_?EXP$/i, '') || rep;
    meta.market = /EXP/i.test(rep) || usd ? 'EXPORT' : 'DOMESTIC';

    const qi = qn.index + qn[0].length;
    // quote date after the number: "& Dt.17-06-2026" | ", Dt.06-06-2026" | " 01-04-2026"
    const qd = t.slice(qi, qi + 45).match(/(\d{2}-\d{2}-\d{4})/);
    if (qd) meta.quote_date = toISO(qd[1]) ?? undefined;

    // detached templates: "<enquiry_no> <enquiry_date> RIL/QT..."
    const before = t.slice(Math.max(0, qn.index - 70), qn.index);
    const eb = before.match(/(.*?)(\d{2}-\d{2}-\d{4})\s*$/);
    if (eb && eb[2]) {
      enqDateDetached = toISO(eb[2]);
      const enq = eb[1].trim().match(/([0-9][0-9A-Za-z/-]*)\s*(?:\([^)]*\))?\s*$/);
      if (enq) enqNoDetached = enq[1];
    }
  }

  // ---- Enquiry No + Date (label form on pump spec sheets) ----
  // "Enquiry No. 67, Date: 08-04-2026" | "Enquiry No. : 130,Dt. 15-04-2026"
  const em = t.match(/Enquiry\s*(?:PR\.?)?\s*No\.?\s*:?\s*([0-9][0-9A-Za-z/-]*)\s*[, ]\s*(?:Date|Dt)\.?\s*:?\s*(\d{2}-\d{2}-\d{4})/i);
  if (em) {
    meta.enquiry_no = em[1];
    meta.enquiry_date = toISO(em[2]) ?? undefined;
  }
  if (!meta.enquiry_no && enqNoDetached) meta.enquiry_no = enqNoDetached;
  if (!meta.enquiry_date && enqDateDetached) meta.enquiry_date = enqDateDetached;

  // ---- Quarter from quote date ----
  if (meta.quote_date) meta.qtr = qtrFromISO(meta.quote_date) ?? undefined;

  // ---- Total offer value ----
  let total: number | null = null;
  const sub = t.match(/SUBTOTAL\s+([\d,]+(?:\.\d+)?)/i);
  const tot = t.match(/\bTOTAL\s*\([^)]*\)\s*([\d,]+(?:\.\d+)?)/i);
  if (sub) total = num(sub[1]);
  else if (tot) total = num(tot[1]);
  if (total == null) {
    const bare = t.match(/Bare Pump Unit Price\s*\(INR\)\s*([\d,]+(?:\.\d+)?)/i);
    // single "... X Qty.Price ... (INR) N" — only when exactly one trailing number
    const xq = t.match(/X\s*Qty\.?\s*Price[^0-9]*\(INR\)\s*((?:[\d,]+(?:\.\d+)?)(?:\s+[\d,]+(?:\.\d+)?)*)/i);
    if (xq && xq[1].trim().split(/\s+/).length === 1) total = num(xq[1]);
    else if (bare) total = num(bare[1]);
  }
  // A USD-denominated quote is left without an offer rather than being written
  // into the rupee column. offer_value_usd was retired (4% filled, never typed —
  // USD is derived from the settings rate for display), and putting a dollar
  // figure in offer_value_inr would understate the quote roughly 86-fold.
  if (total != null && !usd) meta.offer_value_inr = total;

  // ---- Items ----
  if (sub || tot) items.push(...extractTableItems(t, usd));
  else items.push(...extractPumpItems(t));

  return { meta, items };
}

// Tabular spare/commercial quotes: rows between the "Amount …" header and SUBTOTAL.
function extractTableItems(t: string, usd: boolean): ParsedQuoteItem[] {
  const out: ParsedQuoteItem[] = [];
  const sec = t.match(/Amount\s+[iI]n[^]*?(?:INR|UDS|USD)\)?\s*(.+?)\s*SUBTOTAL/i);
  if (!sec) return out;
  const body = sec[1];
  // N Desc Model PartNo UnitCost Qty Amount  (Model has an uppercase letter + a digit)
  const rowRe = /(\d{1,3})\s+([A-Za-z][A-Za-z()/.\- ]*?)\s+([A-Z][A-Z0-9][A-Z0-9\- ]*\d[A-Z0-9\- ]*?)\s+(\S+)\s+([\d,]+(?:\.\d+)?)\s+(\d{1,3})\s+([\d,]+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(body))) {
    const [, , desc, model, partNo, , qty, amount] = m;
    const it = blank();
    it.pump_model = model.trim();
    it.pump_qty = num(qty);
    if (!usd) it.offer_value_inr = num(amount);
    it.detailed_specifications = `${desc.trim()}${partNo && partNo !== '-' ? ` · Part ${partNo}` : ''}`;
    out.push(it);
    if (out.length >= 40) break;
  }
  return out;
}

// Pump spec sheets: single (or first) pump model + qty + speed + price.
function extractPumpItems(t: string): ParsedQuoteItem[] {
  const out: ParsedQuoteItem[] = [];
  const pm = t.match(/Pump Model\s+(.+?)\s+(?:Body|Bearing Housing|Geared Motor Rating|Material of|Sealing Type|Drive Systems|Gear Box|Motor Price|Bore)\b/i);
  if (!pm) return out;
  const it = blank();
  it.pump_model = pm[1].trim();
  const q = t.match(/\bQuantity\s*(?:\([^)]*\))?\s*(\d{1,3})\b/i) || t.match(/\bQty\s+(\d{1,3})\b/i);
  if (q) it.pump_qty = num(q[1]);
  const sp = t.match(/Pump Speed\s+([\d.]+)\s*RPM/i);
  if (sp) it.pump_speed = `${sp[1]} RPM`;
  const bare = t.match(/Bare Pump Unit Price\s*\(INR\)\s*([\d,]+(?:\.\d+)?)/i);
  const paccX = t.match(/Pump with Accessories \+ Drive Motor X\s*Qty\.?Price[^0-9]*\(INR\)\s*([\d,]+(?:\.\d+)?)/i);
  if (paccX) it.offer_value_inr = num(paccX[1]);
  else if (bare) it.offer_value_inr = num(bare[1]);
  const cap = t.match(/Capacity[^0-9]*([\d.]+\s*(?:T\/Hr|TPH|MT\/hr|m3\/hr)?)/i);
  const head = t.match(/\bHead\b[^0-9]*([\d.]+\s*(?:MWC|MLC|m)?)/i);
  const specs: string[] = [];
  if (cap) specs.push(`Capacity ${cap[1].trim()}`);
  if (head) specs.push(`Head ${head[1].trim()}`);
  if (specs.length) it.detailed_specifications = specs.join(' · ');
  out.push(it);
  return out;
}

function blank(): ParsedQuoteItem {
  return {
    pump_model: null, pump_qty: null, pump_speed: null, geared_motor_detail: null,
    motor_price: null, gearbox_vbelt_price: null, offer_value_inr: null,
    detailed_specifications: null,
  };
}
