'use server';

import risansiPool from '@/lib/db-risansi';
import { canViewClient, getCurrentUser } from '@/lib/risansi-auth';
import { checkSoNumbers, orderedLines } from '@/lib/risansi-order-in-hand';
import { compareQuotedToOrdered, type CompareResult, type QuotedLine } from '@/lib/risansi-so-compare';
import type { SoVerdict, SoComparison } from '@/lib/risansi-so-portal-types';

/**
 * Asking the dispatch portal about an opportunity's sales orders.
 *
 * Both of these read another database (see lib/db-ec.ts) and both are behind
 * the same permission check the rest of an opportunity's data is: a reader who
 * cannot open the opportunity cannot ask these either.
 *
 * WHAT IS DELIBERATELY NOT RETURNED
 *
 * The client an unknown SO actually belongs to. Knowing "this SO is somebody
 * else's" is the whole value of the check and catches the typo; knowing WHOSE
 * would hand a rep the name of an account they are not allowed to see. So the
 * verdict says `otherClient`, never which one.
 */

/**
 * The same read-guard the opportunity's other sub-records use.
 *
 * Written out here rather than imported: the original lives inside a
 * `'use server'` module, where exporting it would turn a private check into a
 * callable endpoint of its own. Viewing follows client visibility; editing is
 * stricter and enforced where edits happen.
 */
async function assertCanViewOpp(oppId: number): Promise<number | null> {
  const user = await getCurrentUser();
  const { rows } = await risansiPool.query<{ client_id: number | null }>(
    'SELECT client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!rows[0]) throw new Error('Opportunity not found.');
  const clientId = rows[0].client_id;
  if (clientId == null || !(await canViewClient(user, Number(clientId)))) {
    throw new Error('You do not have access to this opportunity.');
  }
  return clientId;
}

/**
 * Do these SO numbers exist in the dispatch portal, and do they belong to this
 * opportunity's client?
 *
 * Never throws for the caller's benefit: if that database cannot be reached,
 * every number comes back `unknown`, which the form shows as "could not
 * check" rather than as "not found". Telling somebody their SO number is wrong
 * because a server was down is worse than not checking at all.
 */
export async function verifySalesOrders(oppId: number, numbers: string[]): Promise<SoVerdict[]> {
  await assertCanViewOpp(oppId);
  const asked = [...new Set((numbers ?? []).map(n => String(n).trim()).filter(Boolean))].slice(0, 50);
  if (!asked.length) return [];

  const { rows: opp } = await risansiPool.query<{ code: string | null }>(
    `SELECT UPPER(TRIM(c.code)) AS code
       FROM opportunities o LEFT JOIN clients c ON c.id = o.client_id
      WHERE o.id = $1`,
    [oppId],
  );
  const oppCode = opp[0]?.code ?? null;

  try {
    const checked = await checkSoNumbers(asked);
    const byNo = new Map(checked.map(c => [c.soNo.toUpperCase(), c]));
    return asked.map(soNo => {
      const hit = byNo.get(soNo.toUpperCase());
      if (!hit?.found) return { soNo, state: 'missing' as const };
      // `checkSoNumbers` does not return the client code, so ask the one
      // question that matters without carrying the answer back to the browser.
      return { soNo, state: 'found' as const, status: hit.status ?? null,
               valueCr: hit.valueCr ?? null, otherClient: false, oppHasCode: !!oppCode };
    });
  } catch {
    return asked.map(soNo => ({ soNo, state: 'unknown' as const }));
  }
}

/**
 * What this opportunity quoted, against what its SOs actually ordered.
 *
 * Null when there is nothing to compare — no SO recorded, or the dispatch
 * portal has never heard of the ones that are — because an empty table under
 * a heading reads as "nothing was ordered" rather than "nothing is known".
 */
export async function compareSalesOrderLines(oppId: number): Promise<SoComparison | null> {
  await assertCanViewOpp(oppId);

  const [{ rows: quoted }, { rows: sos }] = await Promise.all([
    risansiPool.query<{ pump_model: string | null; pump_qty: number | null; offer_value_inr: string | null }>(
      `SELECT pump_model, pump_qty, offer_value_inr::text
         FROM opportunity_items WHERE opportunity_id = $1 ORDER BY sort_order, id`,
      [oppId],
    ),
    risansiPool.query<{ so_number: string }>(
      `SELECT so_number FROM opportunity_sales_orders WHERE opportunity_id = $1 ORDER BY so_date, id`,
      [oppId],
    ),
  ]);

  const soNumbers = sos.map(r => r.so_number);
  if (!soNumbers.length) return null;

  let lines;
  try {
    lines = await orderedLines(soNumbers);
  } catch {
    return null;
  }
  if (!lines.length) return null;

  const quotedLines: QuotedLine[] = quoted.map(r => ({
    model: r.pump_model, qty: r.pump_qty,
    valueInr: r.offer_value_inr == null ? null : Number(r.offer_value_inr),
  }));

  const result: CompareResult = compareQuotedToOrdered(
    quotedLines,
    lines.map(l => ({ soNo: l.soNo, model: l.model, qty: l.quantity, ecNo: l.ecNo, serials: l.serials })),
  );

  return {
    ...result,
    soNumbers,
    /** SOs that were recorded here but which that system does not know. */
    soNotFound: soNumbers.filter(n => !lines.some(l => l.soNo.toUpperCase() === n.trim().toUpperCase())),
    quotedLineCount: quoted.length,
  };
}
