/**
 * Sending.
 *
 * Best-effort, and that is a deliberate contract rather than laziness:
 * `sendEmail` never throws. An access request that failed to save is a
 * problem; an access request that saved and whose notification did not go out
 * is an inconvenience, and the two must not share a failure path. If a Resend
 * outage could roll back a grant, the system would be less reliable for having
 * notifications than without them.
 *
 * The From domain has to be a domain verified with Resend. `digital.risansi.com`
 * already is — the sales portal sends as `sales-portal@digital.risansi.com` for
 * exactly this reason, and its own comment records the trap: an address on
 * `risansi.com` itself is a different, unverified domain and returns 403.
 */

import { Resend } from 'resend';

let cached: Resend | null | undefined;

function client(): Resend | null {
  if (cached !== undefined) return cached;
  const key = process.env.RESEND_API_KEY;
  cached = key ? new Resend(key) : null;
  if (!key) {
    // Warn rather than throw. A developer running the hub locally should not
    // have to hold an API key to click through an approval.
    console.warn('[notify] RESEND_API_KEY is not set — email is disabled, everything else still works.');
  }
  return cached;
}

const FROM = process.env.RESEND_FROM_DIGITAL
  || 'Risansi Digital <no-reply@digital.risansi.com>';

export interface SendResult {
  ok: boolean;
  id?: string;
  /** 'not-configured' when there is no API key, which is not a fault. */
  error?: string;
  /** How many addresses it actually went to, after de-duplication. */
  recipients?: number;
}

export async function sendEmail(args: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<SendResult> {
  const resend = client();

  // De-duplicate and drop blanks. The approver list is built from a query, and
  // one person appearing twice would send them the same mail twice.
  const to = [...new Set((Array.isArray(args.to) ? args.to : [args.to])
    .map(a => a.trim().toLowerCase())
    .filter(Boolean))];

  if (!to.length) return { ok: false, error: 'no-recipients', recipients: 0 };
  if (!resend) return { ok: false, error: 'not-configured', recipients: to.length };

  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject: args.subject,
      html: args.html,
      replyTo: args.replyTo ?? process.env.RESEND_REPLY_TO ?? undefined,
    });
    if (error) {
      console.error('[notify] send failed:', error);
      return { ok: false, error: String((error as { message?: string }).message ?? error), recipients: to.length };
    }
    return { ok: true, id: data?.id, recipients: to.length };
  } catch (e) {
    console.error('[notify] send threw:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'unknown', recipients: to.length };
  }
}

/** Where the hub lives, for the button in every email. */
export function hubUrl(path = '/'): string {
  const base = (process.env.HUB_URL || 'https://digital.risansi.com').replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
