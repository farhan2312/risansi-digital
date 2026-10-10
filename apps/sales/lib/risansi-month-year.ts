// Expected-close is captured as a month + year only. Stored in opportunities.eta_text
// as the canonical "Mon YYYY" (e.g. "Aug 2026"); this module parses the various
// free-text shapes that predate the dropdown and formats the canonical form.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Parse a free-text expected-close into { m: 0-11, y: 4-digit } or null. */
export function parseMonthYear(raw: string | null | undefined): { m: number; y: number } | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // ISO-ish: 2026-08 / 2026/8
  let mm = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (mm) { const y = +mm[1], m = +mm[2] - 1; if (m >= 0 && m < 12) return { m, y }; }
  // 08/2026 / 8-2026
  mm = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (mm) { const m = +mm[1] - 1, y = +mm[2]; if (m >= 0 && m < 12) return { m, y }; }

  // Month name (full or short) + a year.
  const low = s.toLowerCase();
  let m = -1;
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b${FULL[i]}\\b`).test(low) || new RegExp(`\\b${MONTHS[i].toLowerCase()}\\b`).test(low)) { m = i; break; }
  }
  if (m >= 0) {
    const y4 = low.match(/\b(19|20)\d{2}\b/);
    if (y4) return { m, y: +y4[0] };
    const y2 = low.match(/\b(\d{2})\b/);           // "aug 26" → 2026
    if (y2) return { m, y: 2000 + +y2[1] };
  }
  return null;
}

/** Canonical display/storage form, e.g. "Aug 2026". */
export function formatMonthYear(m: number, y: number): string {
  return `${MONTHS[m]} ${y}`;
}

/** Normalise any input to canonical "Mon YYYY", or '' when it can't be parsed. */
export function normalizeMonthYear(raw: string | null | undefined): string {
  const p = parseMonthYear(raw);
  return p ? formatMonthYear(p.m, p.y) : '';
}
