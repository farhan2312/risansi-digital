import 'server-only';
import risansiPool from '@/lib/db-risansi';

// Which columns the opportunities table actually has, cached per server instance.
//
// WHY A READ PATH NEEDS THIS
//
// The writes in app/actions/risansi.ts have narrowed themselves to the live
// columns for a long time, so a column added by an unrun migration costs a
// write nothing. The reads had no such guard, and on 20 Nov 2026 that showed:
// the pipeline board named o.revisit_on in its SELECT before migration 0133 had
// been run. Postgres rejects the whole statement for one unknown column, the
// page's q() helper turned the rejection into an empty array, and every card on
// the board vanished while the stage headers — fed by a separate aggregate that
// did not name the column — went on reporting 395 quoted and 1203 won.
//
// A board that silently shows nothing is the worst failure this page has: it
// reads as data loss. So a read that wants an optional column asks first.
//
// The cache refreshes on a miss, once, for the same reason the write-side cache
// does: an instance that started before a migration would otherwise keep a
// column list from before it until it was redeployed, and the column would stay
// invisible long after it existed.

let cached: Set<string> | null = null;
let refreshedAt = 0;
const REFRESH_AFTER_MS = 60_000;

async function load(): Promise<Set<string>> {
  try {
    const { rows } = await risansiPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'opportunities'`,
    );
    cached = new Set(rows.map(r => r.column_name));
    refreshedAt = Date.now();
  } catch {
    // Leave whatever we had. An unreachable database is not evidence that a
    // column is gone, and treating it as such would strip columns from every
    // query the moment the pool hiccups.
    cached ??= new Set();
  }
  return cached;
}

/** True when `opportunities` has this column. Re-reads on a miss, at most once a minute. */
export async function hasOppColumn(name: string): Promise<boolean> {
  let cols = cached ?? await load();
  if (!cols.has(name) && Date.now() - refreshedAt > REFRESH_AFTER_MS) cols = await load();
  return cols.has(name);
}

/**
 * A SELECT fragment for an optional date column, or '' when it does not exist.
 *
 * Dates come back as ::text on purpose, the same reason every other date on
 * this page does: a type="date" input cannot read an ISO timestamp, and a raw
 * date column reaches the browser as a JS Date which the form hands straight
 * back to Postgres, losing the edit.
 */
export async function optionalDateSel(name: string): Promise<string> {
  return (await hasOppColumn(name)) ? `o.${name}::text AS ${name},` : '';
}
