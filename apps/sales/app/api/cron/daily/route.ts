import {
  runOverdueActionReminders,
  runOverdueComplaintReminders,
  runAdminOverdueEscalation,
} from '@/lib/risansi-notify';

// Daily reminder sweep, run by Vercel Cron (see vercel.json, 08:00 IST).
// Security: Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is
// set — we require it. When it's unset the route is open ONLY outside production
// (local/dev); in production a missing secret fails closed. Set CRON_SECRET in
// the Vercel env (all environments incl. Preview) to enable the crons.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });

  // Run the three sweeps concurrently — each is self-contained and best-effort,
  // so the admin escalation can't be starved by a long reminder loop.
  const [actionReminders, complaintReminders, adminEscalations] = await Promise.all([
    runOverdueActionReminders(),
    runOverdueComplaintReminders(),
    runAdminOverdueEscalation(),
  ]);

  return Response.json({ ok: true, actionReminders, complaintReminders, adminEscalations });
}
