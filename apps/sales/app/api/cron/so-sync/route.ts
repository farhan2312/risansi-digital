import { syncSalesOrders, lastSoSync } from '@/lib/risansi-so-sync';

/**
 * Refresh the local mirror of the SO portal's order book.
 *
 * Run by Vercel Cron four times a day (see vercel.json). The book is read for
 * reports, not for chasing a dispatch, so hours of lag cost nothing; four runs
 * means the morning figure is never older than breakfast.
 *
 * Security is the same shape as the other crons: Vercel sends
 * `Authorization: Bearer $CRON_SECRET`, and with no secret set the route is
 * open ONLY outside production. It fails closed in production, because an open
 * endpoint here would let anybody make the server do two databases' worth of
 * work on demand.
 *
 * POST does the same thing, so a person with the secret can force a refresh
 * without waiting for the schedule.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

async function run(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });

  try {
    const result = await syncSalesOrders();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    // The mirror keeps whatever it had: the sync is one transaction and a
    // failure rolls it back. Reports go on showing the last good copy, which
    // is the right answer — a stale order book is useful and an empty one is
    // a false alarm.
    const since = await lastSoSync().catch(() => null);
    console.error('so-sync failed:', e instanceof Error ? e.message : e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Sync failed.', lastGood: since },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
