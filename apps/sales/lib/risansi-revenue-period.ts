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
