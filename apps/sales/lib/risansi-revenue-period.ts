// The Month cell of the revenue upload, read as a period.
//
const MONTH_MAP: Record<string, string> = {
  Jan:'01', Feb:'02', Mar:'03', Apr:'04',
  May:'05', Jun:'06', Jul:'07', Aug:'08',
  Sep:'09', Oct:'10', Nov:'11', Dec:'12',
};

/**
 * "Sep-2026" is the whole month, as it always was. "Sep-2026 H1" (also
 * "Sep-2026-1", "Sep-2026 1-15") is the first fortnight, stored on the 1st
 * with half = 1; "Sep-2026 H2" ("-2", "16-30") the second, stored on the 16th
 * with half = 2. Same (client, month) key either way, so a fortnight upload
 * cannot double up with a whole-month row for the same days.
 */
export function parsePeriod(raw: string): { month: string; half: 1 | 2 | null } | null {
  const t = (raw ?? '').trim();

  // A real date, however Excel handed it over.
  //
  // The template used to put a `type="date"` validation on the Month column,
  // so Excel refused the "May-2026" this function reads and pushed everybody
  // towards entering a date instead. A date cell comes back from the sheet as
  // a serial number (46157) or as ISO text, neither of which the pattern below
  // matches, so the row read "Invalid month format" or was skipped on save.
  // The template no longer asks for a date, but the files already filled in
  // under it still exist, and they are readable: a date IS a month.
  const iso = t.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (iso) {
    const mo = Number(iso[2]);
    if (mo < 1 || mo > 12) return null;
    const day = iso[3] ? Number(iso[3]) : 1;
    return { month: `${iso[1]}-${String(mo).padStart(2, '0')}-${day >= 16 ? '16' : '01'}`, half: day >= 16 ? 2 : null };
  }
  if (/^\d{3,6}(\.\d+)?$/.test(t)) {
    const d = excelSerialToUTC(Number(t));
    if (!d) return null;
    const day = d.getUTCDate();
    return {
      month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${day >= 16 ? '16' : '01'}`,
      half: day >= 16 ? 2 : null,
    };
  }
  const m = t.match(/^([A-Za-z]{3})[a-z]*[-\s\/]+(\d{4})(?:[-\s]*(?:H\s*([12])|([12])\b|(1\s*[-–]\s*15)|(16\s*[-–]\s*(?:28|29|30|31))))?\s*$/i);
  if (!m) return null;
  const mon = MONTH_MAP[m[1].slice(0, 1).toUpperCase() + m[1].slice(1, 3).toLowerCase()];
  if (!mon) return null;
  const half: 1 | 2 | null = m[3] ? (Number(m[3]) as 1 | 2) : m[4] ? (Number(m[4]) as 1 | 2) : m[5] ? 1 : m[6] ? 2 : null;
  return { month: `${m[2]}-${mon}-${half === 2 ? '16' : '01'}`, half };
}

/** Label for a stored period: "Sep 26", "Sep 26 · 1–15", "Sep 26 · 16–30". */
export function periodLabel(ymd: string, half: number | null | undefined, opts: { long?: boolean } = {}): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', opts.long ? { month: 'long', year: 'numeric', timeZone: 'UTC' } : { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const h = half ?? (d >= 16 ? 2 : null);
  if (h === 1) return `${base} · 1–15`;
  if (h === 2) { const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return `${base} · 16–${last}`; }
  return base;
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * An Excel date serial as a UTC Date, or null if it isn't one.
 *
 * Day 1 is 1900-01-01 and Excel believes 1900 was a leap year, which is why
 * the epoch here is 1899-12-30 rather than the 31st. Everything is in UTC on
 * purpose: building the date with local getters in IST shifts it back a day
 * and turns the 1st of a month into the last of the month before.
 */
function excelSerialToUTC(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 61 || serial > 100000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
}

/**
 * A Month cell as the canonical text the upload speaks ("May-2026", or
 * "May-2026 H2" for a fortnight), or null when it cannot be read as a period.
 *
 * Normalising here rather than at each reader is what keeps the preview table,
 * its date sort and the server's own parse from disagreeing about a cell: all
 * three end up looking at the same string.
 */
export function periodCellToLabel(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const day = v.getUTCDate();
    return `${SHORT[v.getUTCMonth()]}-${v.getUTCFullYear()}${day >= 16 ? ' H2' : ''}`;
  }
  const p = parsePeriod(String(v));
  if (!p) return null;
  const [y, mo] = p.month.split('-');
  return `${SHORT[Number(mo) - 1]}-${y}${p.half === 1 ? ' H1' : p.half === 2 ? ' H2' : ''}`;
}

/**
 * The periods the template offers in its Month dropdown: three years back to
 * one year ahead, newest first, each whole month followed by its fortnights.
 */
export function periodChoices(today = new Date()): string[] {
  const out: string[] = [];
  const y = today.getUTCFullYear(), m = today.getUTCMonth();
  for (let i = 12; i >= -36; i--) {
    const d = new Date(Date.UTC(y, m + i, 1));
    const base = `${SHORT[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
    out.push(base, `${base} H1`, `${base} H2`);
  }
  return out;
}
