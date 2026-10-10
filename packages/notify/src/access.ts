/**
 * The four emails that make the access-request flow visible to the people in it.
 *
 * Without them the flow works and nobody can tell. Somebody asks for a portal
 * and waits with no idea whether anyone saw it; the approver only finds out by
 * happening to notice a number on a button. That is the gap these close.
 *
 * Who gets told what:
 *
 *   requested  → the approvers. The person who asked already sees their tile
 *                say "Requested", so a confirmation to them would be noise.
 *   decided    → the person who asked, approved or refused. A refusal is still
 *                worth sending: silence reads as nobody having looked.
 *   backlog    → the approvers, once a day, and only when something is waiting.
 *
 * Every function takes a client rather than opening one, and none of them
 * throws — see send.ts on why a failed notification must never undo the thing
 * it was notifying about.
 */

import { renderCard } from './card.js';
import { sendEmail, hubUrl, type SendResult } from './send.js';

export interface Queryable {
  query<R = Record<string, unknown>>(
    sql: string, params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

const NEGATIVE = '#991B1B';

/** Everyone who can decide a request. One approver covers every application. */
async function approvers(db: Queryable): Promise<{ email: string; name: string }[]> {
  const { rows } = await db.query<{ email: string; name: string }>(
    `SELECT email, name FROM identity.users
      WHERE role = 'approver' AND is_active AND email IS NOT NULL
      ORDER BY name`,
  );
  return rows;
}

const days = (from: Date | string): number =>
  Math.floor((Date.now() - new Date(from).getTime()) / 86_400_000);

/** How long something has been waiting, in words rather than a timestamp. */
function waitedFor(since: Date | string): string {
  const d = days(since);
  if (d <= 0) return 'today';
  if (d === 1) return '1 day';
  return `${d} days`;
}

/**
 * Somebody asked for access. Tell whoever can grant it.
 *
 * Sent one by one rather than to the whole list at once, so no approver learns
 * the others' addresses from a To: header and each gets their own name in the
 * greeting.
 */
export async function notifyAccessRequested(db: Queryable, a: {
  requesterName: string;
  requesterEmail: string;
  appName: string;
  reason?: string | null;
}): Promise<SendResult> {
  const who = await approvers(db);
  if (!who.length) {
    // Worth a log line: a request nobody can see is the failure mode this
    // whole file exists to prevent, and it happens if no approver is set.
    console.warn('[notify] an access request arrived and no active approver exists to tell.');
    return { ok: false, error: 'no-approvers', recipients: 0 };
  }

  let last: SendResult = { ok: false, error: 'none-sent' };
  for (const p of who) {
    last = await sendEmail({
      to: p.email,
      subject: `${a.requesterName} has asked for access to ${a.appName}`,
      html: renderCard({
        section: 'Access request',
        greetingName: p.name?.split(' ')[0] ?? null,
        intro: `${a.requesterName} has asked for access to ${a.appName}. Nothing has been granted — it is waiting for you.`,
        title: a.appName,
        body: a.reason ? `Their reason:\n${a.reason}` : 'They gave no reason.',
        meta: [
          ['Requested by', a.requesterName],
          ['Email', a.requesterEmail],
          ['Application', a.appName],
        ],
        ctaLabel: 'Review the request',
        ctaUrl: hubUrl('/requests'),
        footer: 'You are receiving this because you approve access for Risansi Digital.',
      }),
    });
  }
  return { ...last, recipients: who.length };
}

/** A request was decided. Tell the person who asked, either way. */
export async function notifyAccessDecided(a: {
  requesterName: string;
  requesterEmail: string;
  appName: string;
  appUrl: string;
  approved: boolean;
  /** The portal's own role, when approved. */
  appRole?: string | null;
  roleLabel?: string | null;
  decidedByName?: string | null;
  note?: string | null;
}): Promise<SendResult> {
  if (a.approved) {
    return sendEmail({
      to: a.requesterEmail,
      subject: `You now have access to ${a.appName}`,
      html: renderCard({
        section: 'Access approved',
        greetingName: a.requesterName?.split(' ')[0] ?? null,
        intro: `Your access to ${a.appName} has been approved. Sign in at Risansi Digital and it will be there — you do not need a separate password for it.`,
        title: a.appName,
        body: a.note || null,
        meta: [
          ['Your role', a.roleLabel || a.appRole || ''],
          ['Approved by', a.decidedByName || ''],
        ],
        ctaLabel: `Open ${a.appName}`,
        ctaUrl: a.appUrl,
        footer: 'Sent by Risansi Digital. Replies to this address are not read.',
      }),
    });
  }

  return sendEmail({
    to: a.requesterEmail,
    subject: `Your request for ${a.appName} was not approved`,
    html: renderCard({
      section: 'Access request',
      accent: NEGATIVE,
      greetingName: a.requesterName?.split(' ')[0] ?? null,
      // Says who decided, so there is somebody to go and talk to. A refusal
      // with no name attached leaves a person with nowhere to take it.
      intro: `Your request for access to ${a.appName} was not approved${a.decidedByName ? ` by ${a.decidedByName}` : ''}.`
        + ' If you think you need it, the best next step is to speak to them directly.',
      title: a.appName,
      body: a.note || 'No reason was given.',
      ctaLabel: 'Back to Risansi Digital',
      ctaUrl: hubUrl('/'),
      footer: 'Sent by Risansi Digital. Replies to this address are not read.',
    }),
  });
}

/**
 * The daily sweep: one mail per approver listing everything still waiting.
 *
 * One ladder, not two. The sales portal escalates to a sysadmin after five
 * days, which suits a sales action nobody is blocked on. Access to a portal is
 * different: somebody cannot do their job while they wait, and five days of
 * silence is already the failure. So this goes out every day there is anything
 * pending, with the oldest age in the subject line, and marks anything over
 * three days as overdue. A daily mail that says "oldest 4 days" is harder to
 * leave alone than a threshold that fires once.
 *
 * Sends nothing when the queue is empty. A daily "nothing to do" email is how
 * people learn to filter the address.
 */
export async function notifyPendingBacklog(db: Queryable): Promise<SendResult & { pending: number }> {
  const { rows: pending } = await db.query<{
    name: string; email: string; app_name: string; requested_at: string; reason: string | null;
  }>(
    `SELECT u.name, u.email, a.name AS app_name, g.requested_at, g.requested_reason AS reason
       FROM identity.app_grants g
       JOIN identity.users u ON u.id = g.user_id
       JOIN identity.apps  a ON a.slug = g.app_slug
      WHERE g.status = 'Pending' AND u.is_active
      ORDER BY g.requested_at`,
  );

  if (!pending.length) return { ok: true, error: undefined, recipients: 0, pending: 0 };

  const who = await approvers(db);
  if (!who.length) {
    console.warn(`[notify] ${pending.length} access request(s) pending and no active approver to tell.`);
    return { ok: false, error: 'no-approvers', recipients: 0, pending: pending.length };
  }

  const oldest = pending[0];
  const overdue = pending.filter(p => days(p.requested_at) >= 3).length;
  const subject = pending.length === 1
    ? `1 access request is waiting (${waitedFor(oldest.requested_at)})`
    : `${pending.length} access requests are waiting (oldest ${waitedFor(oldest.requested_at)})`;

  let last: SendResult = { ok: false, error: 'none-sent' };
  for (const p of who) {
    last = await sendEmail({
      to: p.email,
      subject,
      html: renderCard({
        section: 'Access requests waiting',
        accent: overdue ? NEGATIVE : undefined,
        greetingName: p.name?.split(' ')[0] ?? null,
        intro: overdue
          ? `${pending.length} request${pending.length === 1 ? '' : 's'} waiting, ${overdue} of them for three days or more. Each of these people cannot use the portal they asked for until it is decided.`
          : `${pending.length} request${pending.length === 1 ? '' : 's'} waiting to be decided.`,
        meta: pending.slice(0, 12).map(r => [
          `${r.name} · ${r.app_name}`,
          `waiting ${waitedFor(r.requested_at)}`,
        ] as [string, string]),
        body: pending.length > 12 ? `… and ${pending.length - 12} more.` : null,
        ctaLabel: 'Review them',
        ctaUrl: hubUrl('/requests'),
        footer: 'Sent once a day while anything is waiting, and not at all when the queue is empty.',
      }),
    });
  }
  return { ...last, recipients: who.length, pending: pending.length };
}
