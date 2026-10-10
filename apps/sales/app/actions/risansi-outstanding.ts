'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';
import { DEBTOR_USER } from '@/lib/risansi-outstanding-debtors';

export interface OutstandingRow {
  client_code: string;
  debtor:      string;   // raw DEBTOR code from the sheet
  amount:      number;
}

export interface OutstandingUploadResult {
  matched:      number;
  skipped:      number;
  skippedCodes: string[];
  grandTotal:   number;
}

/**
 * Why this returns a failure instead of throwing one.
 *
 * Next.js redacts every error thrown out of a server action in production. The
 * browser receives "An unexpected response was received from the server" and the
 * real reason — the constraint, the column, the value — stays on the server where
 * nobody reading the screen can act on it. That is exactly how this upload came
 * to fail silently for weeks: the message existed, it just never left the box.
 *
 * A returned value is not redacted. So the action catches its own failure and
 * hands back what actually went wrong, along with the Postgres error code and
 * constraint name when there is one.
 */
export type OutstandingUploadOutcome =
  | ({ ok: true } & OutstandingUploadResult)
  | { ok: false; error: string; code?: string; detail?: string };

// Full-replace upload: every monthly sheet clears ALL prior outstanding and
// loads itself in one transaction. Amount → clients.total_outstanding; the
// snapshot as-of date + mapped owner + raw debtor code ride along per client.
export async function uploadOutstanding(
  rows: OutstandingRow[], asOfDate: string, filename: string,
): Promise<OutstandingUploadOutcome> {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? '';
  if (!hasRole(role, 'admin')) {
    return { ok: false, error: 'You are signed in as ' + (role || 'an unknown role') + ', which cannot upload outstanding data. An admin has to do it.' };
  }
  const email = session?.user?.email;
  if (!email) return { ok: false, error: 'Your session has no email address on it. Sign out and back in, then try again.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    return { ok: false, error: `As-of date "${asOfDate}" is not a YYYY-MM-DD date.` };
  }
  if (!rows.length) return { ok: false, error: 'The sheet had no rows to save.' };

  let c;
  try {
    c = await risansiPool.connect();
  } catch (e) {
    // Worth its own message: a pool that cannot hand out a connection looks
    // identical to a broken query from the outside, and the fix is different.
    return { ok: false, error: 'Could not get a database connection: ' + msg(e) };
  }
  let committed = false;
  try {
    await c.query('BEGIN');

    // 1. Wipe the previous snapshot from every client.
    await c.query(
      `UPDATE clients
          SET total_outstanding = NULL, outstanding_as_of = NULL,
              outstanding_owner_id = NULL, outstanding_debtor_code = NULL
        WHERE total_outstanding IS NOT NULL
           OR outstanding_as_of IS NOT NULL
           OR outstanding_debtor_code IS NOT NULL`,
    );

    // 2. Apply the new sheet in ONE statement, matching on client code.
    //
    //    This used to be one UPDATE per row inside the loop, which is one network
    //    round trip per row against a Postgres in another region. 210 rows fitted
    //    inside the 10s cap vercel.json puts on app/**; 294 did not, and the
    //    upload failed with nothing on screen to say so. Measured on the same
    //    data: 294 serial updates 4529ms, this one statement 37ms.
    //
    //    Two sheet rows can carry the same client code. The loop let the last one
    //    win; a set-based UPDATE joined against both would pick one arbitrarily,
    //    so they are collapsed here first, keeping that same last-wins rule.
    const wanted = new Map<string, { amount: number; ownerId: number | null; debtor: string | null }>();
    for (const r of rows) {
      const code = (r.client_code ?? '').trim().toUpperCase();
      if (!code) continue;
      const debtor = (r.debtor ?? '').trim().toUpperCase();
      wanted.set(code, {
        amount:  Number(r.amount) || 0,
        ownerId: DEBTOR_USER[debtor] ?? null,
        debtor:  debtor || null,
      });
    }

    const codes   = [...wanted.keys()];
    const amounts = codes.map(k => wanted.get(k)!.amount);
    const owners  = codes.map(k => wanted.get(k)!.ownerId);
    const debtors = codes.map(k => wanted.get(k)!.debtor);

    const applied = codes.length
      ? await c.query<{ code: string; amount: string }>(
          `UPDATE clients cl
              SET total_outstanding       = v.amount,
                  outstanding_as_of       = $2::date,
                  outstanding_owner_id    = v.owner_id,
                  outstanding_debtor_code = v.debtor
             FROM (SELECT * FROM unnest($1::text[], $3::numeric[], $4::int[], $5::text[])
                     AS t(code, amount, owner_id, debtor)) v
            WHERE UPPER(cl.code) = v.code AND cl.deleted_at IS NULL
        RETURNING v.code AS code, v.amount::text AS amount`,
          [codes, asOfDate, amounts, owners, debtors],
        )
      : { rows: [] as { code: string; amount: string }[] };

    const hit        = new Set(applied.rows.map(r => r.code));
    const matched    = hit.size;
    const grandTotal = applied.rows.reduce((sum, r) => sum + Number(r.amount), 0);
    const skipped    = codes.filter(k => !hit.has(k));

    // Compared against the codes actually attempted, not the raw row count —
    // blank-code rows are dropped above and would otherwise make a fully
    // successful upload look partial.
    const status = matched === 0 && codes.length > 0 ? 'failed'
                 : skipped.length > 0                ? 'partial' : 'success';

    await c.query(
      `INSERT INTO outstanding_upload_log
         (uploaded_by, filename, as_of_date, rows_total, rows_matched,
          rows_skipped, skipped_codes, grand_total, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [email, filename, asOfDate, rows.length, matched, skipped.length, skipped, grandTotal, status],
    );

    await c.query('COMMIT');
    committed = true;
    return { ok: true, matched, skipped: skipped.length, skippedCodes: skipped, grandTotal };
  } catch (e) {
    if (!committed) await c.query('ROLLBACK').catch(() => {});
    const err = e as { code?: string; constraint?: string; detail?: string; column?: string; table?: string };
    // Logged as well as returned: the return reaches whoever is looking at the
    // screen, the log reaches whoever is reading Vercel later.
    console.error('[uploadOutstanding] failed', {
      code: err?.code, constraint: err?.constraint, table: err?.table,
      column: err?.column, detail: err?.detail, message: msg(e),
    });
    return {
      ok: false,
      error: msg(e),
      code: err?.code,
      detail: [err?.constraint && `constraint ${err.constraint}`,
               err?.table && `table ${err.table}`,
               err?.column && `column ${err.column}`,
               err?.detail].filter(Boolean).join(' · ') || undefined,
    };
  } finally {
    c.release();
    // Outside the try: a revalidate that throws must not turn a committed upload
    // into a reported failure, which is what putting it before the return did.
    if (committed) { try { revalidatePath('/risansi/admin/outstanding'); } catch { /* cache only */ } }
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'Unknown error';
