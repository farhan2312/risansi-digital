import { runWeeklyManagerDigest } from '@/lib/risansi-notify';

// Weekly manager digest, run by Vercel Cron (Monday 08:00 IST). See the daily
// route for the CRON_SECRET note.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';   // fail closed in prod
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  const managerDigests = await runWeeklyManagerDigest();
  return Response.json({ ok: true, managerDigests });
}
