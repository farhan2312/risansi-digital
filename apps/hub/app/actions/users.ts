'use server';

/**
 * Creating somebody, rather than waiting for them to ask.
 *
 * The hub had one way in: a person signs up, then asks for each application
 * and waits to be approved. That is the right flow for somebody who is
 * already here and discovers they need something. It is the wrong flow for a
 * new joiner, where the access is known on their first morning and the only
 * thing the request step adds is a delay and three emails.
 *
 * So an approver can create the account and grant the applications in one go.
 * The person signs in with a password they are told once, is made to choose
 * their own, and finds their portals already open.
 *
 * ── Why the password is generated and not a house default ───────
 *
 * A single shared starting password is a real weakness, not a theoretical
 * one: anybody who knows it can take an account in the window between it
 * being created and its owner first signing in, and nothing in the logs would
 * look unusual. A generated one closes that window to the people who were
 * actually told it. The forced change limits the damage either way, but it
 * does not remove it.
 *
 * It is shown to the approver once and never stored in readable form. If it
 * is lost before being passed on, create it again rather than hunting for it.
 *
 * ── Why no email carries it ─────────────────────────────────────
 *
 * The person is told their access is ready and where to sign in, and the
 * password travels by whatever the approver considers appropriate. A password
 * sitting in an inbox for ever is worse than one said out loud, and a new
 * joiner is usually standing next to the person creating the account.
 */

import { randomInt } from 'node:crypto';
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  type AppRole,
} from '@risansi/identity';
import { notifyAccessDecided } from '@risansi/notify';
import db from '@/lib/db';
import { logAuthEvent } from '@/lib/audit';
import { requireApprover } from '@/lib/viewer';
import type { ActionState } from '@/app/actions/grants';

export interface CreateUserState {
  error?: string;
  /** Shown once, on success. Never read back from anywhere. */
  created?: { name: string; email: string; password: string; apps: string[] };
}

function text(formData: FormData, field: string): string {
  const v = formData.get(field);
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Readable aloud and long enough to be worth nothing to a guesser.
 *
 * Three words and a number rather than a string of symbols, because this is
 * going to be read down a phone or across a desk, and a password that gets
 * mistyped four times is a password that gets written on a sticky note. The
 * list avoids letters and digits that look alike when handwritten.
 */
const WORDS = [
  'anchor', 'basalt', 'cobalt', 'dynamo', 'ember', 'fathom', 'granite',
  'harbour', 'indigo', 'jigsaw', 'kelvin', 'lantern', 'meadow', 'nickel',
  'orbit', 'pumice', 'quarry', 'ribbon', 'summit', 'tundra', 'umber',
  'velvet', 'walnut', 'yonder', 'zephyr',
];

function generatePassword(): string {
  const pick = () => WORDS[randomInt(WORDS.length)]!;
  const word = () => { const w = pick(); return w[0]!.toUpperCase() + w.slice(1); };
  const pw = `${word()}-${pick()}-${pick()}-${randomInt(10, 100)}`;
  // The generator cannot produce anything shorter, but the floor is the
  // package's and this is the one place a new password is minted without a
  // human seeing the rule.
  return pw.length >= MIN_PASSWORD_LENGTH ? pw : `${pw}-${randomInt(1000, 10000)}`;
}

export async function createUserAction(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const approver = await requireApprover();

  const name = text(formData, 'name');
  const email = text(formData, 'email').toLowerCase();

  if (!name) return { error: 'Give them a name — it is what everybody else sees on their work.' };
  if (!email.includes('@') || email.startsWith('@') || email.split('@').length !== 2) {
    return { error: 'That does not look like an email address.' };
  }

  // Any domain, deliberately. Signing up is restricted to @risansi.com, but
  // somebody creating an account by hand has already decided, and there is at
  // least one contractor on another domain who could never have signed up.
  const { rows: existing } = await db.query<{ email: string }>(
    `SELECT email FROM identity.users WHERE lower(email) = $1`,
    [email],
  );
  if (existing[0]) {
    return { error: `${email} already has an account. Grant them an application from the Requests tab instead.` };
  }

  // Which applications, and as what. A missing or empty value means "not this
  // one" rather than "no role", so an approver can create somebody with
  // access to one portal and not the other three.
  const { rows: apps } = await db.query<{ slug: string; name: string; needs_grant: boolean; coming_soon: boolean }>(
    `SELECT slug, name, needs_grant, coming_soon FROM identity.apps WHERE is_live ORDER BY sort_order`,
  );
  const wanted = apps
    .map(a => ({ app: a, role: text(formData, `role:${a.slug}`) }))
    .filter(x => x.role);

  for (const { app, role } of wanted) {
    // An application that is not open yet CAN be granted here, deliberately.
    // Requesting one is still refused — that is what had five people asking
    // for something nobody could grant — but an approver setting it up ahead
    // of the portal opening is the opposite problem. The grant simply sits
    // there: the tile stays greyed and the portal does not read grants yet,
    // so nothing happens until it does, and then it already works.
    const { rows } = await db.query<{ role: string }>(
      `SELECT role FROM identity.app_roles WHERE app_slug = $1 AND role = $2`,
      [app.slug, role],
    );
    if (!rows[0]) return { error: `${role} is not a role ${app.name} has.` };
  }

  const password = generatePassword();
  const hash = await hashPassword(password);

  // One transaction: an account created without its grants is the exact
  // situation this feature exists to avoid, and it would leave somebody
  // signed in to a hub with nothing on it.
  await db.query('BEGIN');
  let userId: string;
  try {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, must_change_password, is_active, role)
       VALUES ($1, $2, $3, true, true, 'member')
       RETURNING id::text AS id`,
      [email, name, hash],
    );
    userId = rows[0]!.id;

    for (const { app, role } of wanted) {
      await db.query(
        `INSERT INTO identity.app_grants
           (user_id, app_slug, status, app_role, decided_by, decided_at, decided_note)
         VALUES ($1, $2, 'Approved', $3, $4, now(), $5)`,
        [userId, app.slug, role, approver.id,
         `Granted at account creation by ${approver.email}.`],
      );
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    return { error: e instanceof Error ? e.message : 'Could not create the account.' };
  }

  await logAuthEvent({
    event: 'user_created',
    email,
    userId,
    detail: `created by ${approver.email}${wanted.length ? `, granted ${wanted.map(w => `${w.app.slug}:${w.role}`).join(', ')}` : ', no applications'}`,
  });

  // Tells them it is ready and where to go. Never the password.
  for (const { app, role } of wanted) {
    const { rows } = await db.query<{ label: string; url: string }>(
      `SELECT r.label, a.url FROM identity.app_roles r
         JOIN identity.apps a ON a.slug = r.app_slug
        WHERE r.app_slug = $1 AND r.role = $2`,
      [app.slug, role],
    );
    await notifyAccessDecided({
      requesterName: name,
      requesterEmail: email,
      appName: app.name,
      appUrl: rows[0]?.url ?? '',
      approved: true,
      appRole: role,
      roleLabel: rows[0]?.label ?? role,
      decidedByName: approver.name,
    });
  }

  return {
    created: {
      name,
      email,
      password,
      apps: wanted.map(w => w.app.name),
    },
  };
}

/**
 * Give somebody a new password because they cannot get in.
 *
 * The three portals each had their own version of this, which meant a
 * forgotten password could be fixed in four places and the one that got used
 * depended on who you asked. There is one now.
 *
 * Same shape as creation: generated, shown once, never stored readably, and
 * `must_change_password` set so the approver's choice does not become the
 * person's permanent password.
 *
 * Deliberately not an email. A reset link in an inbox is a second way into
 * the account for as long as the inbox is readable, and the person asking
 * for a reset is almost always already talking to whoever is doing it.
 */
export async function resetPasswordAction(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const approver = await requireApprover();
  const email = text(formData, 'email').toLowerCase();
  if (!email) return { error: 'Which account?' };

  const password = generatePassword();
  const hash = await hashPassword(password);

  const { rows } = await db.query<{ name: string; email: string }>(
    `UPDATE identity.users
        SET password_hash = $2, must_change_password = true
      WHERE lower(email) = $1 AND is_active
      RETURNING name, email`,
    [email, hash],
  );
  const row = rows[0];
  if (!row) return { error: 'No active account with that address.' };

  await logAuthEvent({
    event: 'password_reset',
    email: row.email,
    detail: `reset by ${approver.email}`,
  });

  return { created: { name: row.name, email: row.email, password, apps: [] } };
}

/**
 * Switch somebody off, or back on.
 *
 * One flag, and it reaches every portal: each of them re-reads the identity
 * row per request, so deactivating here locks all four on the person's next
 * click rather than whenever their session happens to expire. That is the
 * whole reason the grant is not carried in the token.
 *
 * The grants are left exactly as they are. Somebody coming back from leave,
 * or returning after a month, should not have to be re-approved for four
 * applications — and an offboarding that turns out to be a mistake should be
 * one switch to undo.
 */
export async function setActiveAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const approver = await requireApprover();
  const email = text(formData, 'email').toLowerCase();
  const active = text(formData, 'active') === 'true';
  if (!email) return { error: 'Which account?' };

  if (email === approver.email.toLowerCase() && !active) {
    return { error: 'You cannot deactivate your own account. Ask the other approver.' };
  }

  const { rows } = await db.query<{ name: string }>(
    `UPDATE identity.users SET is_active = $2 WHERE lower(email) = $1 AND is_active <> $2
      RETURNING name`,
    [email, active],
  );
  if (!rows[0]) return { notice: active ? 'They were already active.' : 'They were already deactivated.' };

  await logAuthEvent({
    event: active ? 'user_reactivated' : 'user_deactivated',
    email,
    detail: `${active ? 'reactivated' : 'deactivated'} by ${approver.email}`,
  });

  return {
    notice: active
      ? `${rows[0].name} can sign in again. Their grants were never touched.`
      : `${rows[0].name} is locked out of every portal, from their next click.`,
  };
}

/** The role lists, for the form. One query rather than one per application. */
export async function rolesByApp(): Promise<Record<string, AppRole[]>> {
  const { rows } = await db.query<{ app_slug: string; role: string; label: string; description: string }>(
    `SELECT app_slug, role, label, description FROM identity.app_roles ORDER BY app_slug, sort_order`,
  );
  const out: Record<string, AppRole[]> = {};
  for (const r of rows) {
    (out[r.app_slug] ??= []).push({ role: r.role, label: r.label, description: r.description });
  }
  return out;
}
