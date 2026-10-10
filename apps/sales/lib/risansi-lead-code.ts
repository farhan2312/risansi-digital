// Shared LEAD_ client-code generation.
//
// A lead's code is LEAD_<initials>, where <initials> is the first alphanumeric
// character of each whitespace-delimited word in the company name, uppercased and
// capped at 5 characters. The code carries NO spaces — it is used directly in URLs
// (/risansi/clients/<code>), so a space would 404.
//
// Used by the "Add Client" form (lead mode) and the leads import.

/** Uppercase, collapse runs of whitespace, trim. This is how every client name is stored. */
export function normalizeClientName(name: string): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** First alphanumeric char of each word, uppercased, first 5 chars. */
export function leadInitials(name: string): string {
  let s = '';
  for (const word of String(name ?? '').trim().split(/\s+/)) {
    const m = word.match(/[a-z0-9]/i);   // skip leading punctuation like "(P)Ltd"
    if (m) s += m[0].toUpperCase();
    if (s.length >= 5) break;
  }
  return s.slice(0, 5);
}

/** LEAD_<initials> with no uniqueness check (used for the live form preview). */
export function leadCodeBase(name: string): string {
  return `LEAD_${leadInitials(name) || 'X'}`;
}

/**
 * A unique LEAD_ code. `isTaken` should return true for any code already in use.
 * On collision the initials are truncated to make room for a numeric suffix, so the
 * part after LEAD_ stays ≤ 5 characters (e.g. AGM ENVIRO ENGINEERS → LEAD_AEE, then
 * ASP ENVIRO ENGINEERS → LEAD_AEE2).
 */
export function uniqueLeadCode(name: string, isTaken: (code: string) => boolean): string {
  const init = leadInitials(name) || 'X';
  const base = `LEAD_${init}`;
  if (!isTaken(base)) return base;
  for (let n = 2; n < 100000; n++) {
    const suf  = String(n);
    const cand = `LEAD_${init.slice(0, Math.max(1, 5 - suf.length))}${suf}`;
    if (!isTaken(cand)) return cand;
  }
  return `LEAD_${init}${Math.floor(Date.now() % 100000)}`;   // unreachable in practice
}
