/**
 * The daily sweep: one mail per approver listing every request still waiting.
 *
 * Run by Vercel Cron — see apps/hub/vercel.json, 02:00 UTC, which is 07:30 IST.
 * It sends nothing when the queue is empty, so a quiet day is a quiet inbox and
 * people do not learn to filter the address.
 *
 * Security: Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET
 * is set — we require it. When it is unset the route is open ONLY outside
 * production, so it can be triggered by hand locally; in production a missing
 * secret fails closed. This is the same shape as
 * apps/sales/app/api/cron/daily/route.ts, deliberately: two cron guards that
 * differ are two things to reason about.
 *
 * No `export const dynamic` needed: GET handlers have defaulted to dynamic
 * since 15.0, and this one reads a request header anyway.
 */

import { notifyPendingBacklog } from '@risansi/notify';
import db from '@/lib/db';

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/** How many people could receive a notification at all. Zero explains silence. */
async function approverCount(): Promise<number> {
  try {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity.users WHERE role = 'approver' AND is_active`,
    );
    return rows[0]?.n ?? 0;
  } catch {
    return -1;   // -1 rather than 0: the database was unreachable, which is a different fault
  }
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });

  // Returns a result rather than throwing, so a Resend outage shows up as
  // `ok: false` in the Vercel log instead of a 500 with no detail. The counts
  // are returned so a run that sent nothing can be told apart from a run that
  // had nothing to send.
  const result = await notifyPendingBacklog(db);

  return Response.json({
    ok: result.ok,
    pending: result.pending,
    approversNotified: result.recipients ?? 0,
    error: result.error ?? null,

    // Configuration, reported because "no email arrived" has four causes and
    // they are indistinguishable from the outside. Booleans and a From
    // address only — never the key itself, and the route is behind
    // CRON_SECRET in production regardless.
    //
    //   resendConfigured false  → the key is missing from THIS project and
    //                             environment, or was added without a
    //                             redeploy afterwards
    //   approvers 0             → a request has nobody to be sent to, which
    //                             is silent by design
    //   error 'not-configured'  → same as the first, reported by the sender
    //   any other error         → Resend refused it, and that is the reason
    config: {
      resendConfigured: Boolean(process.env.RESEND_API_KEY),
      from: process.env.RESEND_FROM_DIGITAL || 'Risansi Digital <no-reply@digital.risansi.com>',
      hubUrl: process.env.HUB_URL || '(unset, defaulting to https://digital.risansi.com)',
      approvers: await approverCount(),
    },
  });
}
