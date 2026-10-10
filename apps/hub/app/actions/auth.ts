'use server';

/**
 * Sign in, sign up, sign out, change password.
 *
 * All four are Server Functions invoked from a `<form action={...}>`, so every
 * one of them is a POST and nothing — not an email, not a password, not a
 * return URL — ever appears in a query string. The one exception is `?next=`
 * arriving on /sign-in from a portal bounce, which is a destination rather than
 * a secret, and it is carried from there into the form as a hidden field so the
 * submit itself stays clean.
 *
 * Server Functions are reachable by direct POST, not only through this app's
 * own UI, so each one re-establishes who is calling rather than trusting that
 * a page already did. See the warning in
 * node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  COOKIE_NAME,
  clearedCookieOptions,
  cookieOptions,
  hashPassword,
  issueToken,
  passwordProblem,
  safeReturnUrl,
  verifyPassword,
} from '@risansi/identity';
import db from '@/lib/db';
import { logAuthEvent } from '@/lib/audit';
import { getViewer, requireViewerUnblocked } from '@/lib/viewer';

/** What the form components render back to the person. */
export interface FormState {
  error?: string;
  notice?: string;
}

/**
 * Only Risansi staff, matching what apps/sales/app/api/auth/signup/submit
 * does today. The hub is not a public product and never will be.
 */
const EMAIL_DOMAIN = '@risansi.com';

/**
 * One message for every way a sign-in can fail.
 *
 * Deliberately says nothing about which half was wrong, so the form cannot be
 * used to find out which addresses have accounts. `verifyPassword` runs even
 * when there is no row, against a dummy hash, so the answer does not come back
 * noticeably faster for an address that does not exist either.
 */
const SIGN_IN_FAILED =
  'That email and password do not match an account. Check both and try again.';

function text(formData: FormData, field: string): string {
  const v = formData.get(field);
  return typeof v === 'string' ? v : '';
}

// ── Sign in ────────────────────────────────────────────────────────

export async function signInAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = text(formData, 'email').trim().toLowerCase();
  const password = text(formData, 'password');
  // Checked through the identity package rather than here. An unvalidated
  // redirect on a login page hands a signed-in person to whoever sent the
  // link, and `safeReturnUrl` is the tested implementation of that check.
  const next = safeReturnUrl(text(formData, 'next'), '/');

  if (!email || !password) return { error: SIGN_IN_FAILED };

  const { rows } = await db.query<{
    id: string; email: string; name: string;
    password_hash: string | null; must_change_password: boolean; is_active: boolean;
  }>(
    `SELECT id, email, name, password_hash, must_change_password, is_active
       FROM identity.users
      WHERE lower(email) = $1`,
    [email],
  );

  const row = rows[0];
  // No early return for "no such user": the comparison runs either way, and
  // branching before it is what would make the two cases distinguishable.
  const passwordMatches = await verifyPassword(password, row?.password_hash ?? null);

  if (!row || !passwordMatches || !row.is_active) {
    await logAuthEvent({
      event: 'sign_in_failed',
      email,
      userId: row?.id ?? null,
      detail: !row
        ? 'no account for that address'
        : !passwordMatches
          ? 'wrong password'
          : 'account is inactive',
    });
    return { error: SIGN_IN_FAILED };
  }

  const token = await issueToken({
    userId: row.id,
    email: row.email,
    name: row.name,
    mustChangePassword: row.must_change_password,
  });

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, cookieOptions());

  await db.query(`UPDATE identity.users SET last_seen_at = now() WHERE id = $1`, [row.id]);
  await logAuthEvent({ event: 'sign_in', email: row.email, userId: row.id });

  // Outside any try/catch: redirect() works by throwing, and catching it would
  // swallow the navigation. The docs are explicit about this.
  if (row.must_change_password) redirect('/change-password');
  redirect(next);
}

// ── Sign up ────────────────────────────────────────────────────────

export async function signUpAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = text(formData, 'name').trim();
  const email = text(formData, 'email').trim().toLowerCase();
  const password = text(formData, 'password');

  if (name.length < 2) return { error: 'Please give your full name.' };
  if (!email.endsWith(EMAIL_DOMAIN)) {
    return { error: `Use your Risansi address — it has to end in ${EMAIL_DOMAIN}.` };
  }
  // Nothing before the @, or a second @, would both pass the suffix check.
  const local = email.slice(0, -EMAIL_DOMAIN.length);
  if (!local || local.includes('@')) {
    return { error: `That is not a valid ${EMAIL_DOMAIN} address.` };
  }

  // The package decides what an acceptable password is, and returns the
  // sentence to show rather than a boolean, so this reads it out as-is.
  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  const passwordHash = await hashPassword(password);

  // The account is created with no grants at all: signing up gets you the
  // grid and a Request access button on each tile, nothing more.
  // DO NOTHING + RETURNING makes the duplicate check atomic, so two submits
  // racing cannot overwrite an existing account.
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO identity.users (email, name, password_hash, must_change_password, role)
     VALUES ($1, $2, $3, false, 'member')
     ON CONFLICT (lower(email)) DO NOTHING
     RETURNING id`,
    [email, name, passwordHash],
  );

  const created = rows[0];
  if (!created) {
    return {
      error: 'An account already exists for that address. Sign in instead, '
        + 'or ask for the password to be reset if you have lost it.',
    };
  }

  const token = await issueToken({
    userId: created.id,
    email,
    name,
    mustChangePassword: false,
  });

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, cookieOptions());

  await logAuthEvent({ event: 'sign_up', email, userId: created.id });

  redirect('/');
}

// ── Sign out ───────────────────────────────────────────────────────

/**
 * A POST, never a GET.
 *
 * A link that signs you out can be fired by anything that can get your browser
 * to make a request — an image tag in an email is enough. Clearing the cookie
 * is only an annoyance rather than a breach, but it is free to do properly.
 */
export async function signOutAction(): Promise<void> {
  // Read before clearing, so there is something to write to the log.
  const viewer = await getViewer();

  const jar = await cookies();
  // Matching attributes, through the package, or the browser keeps the cookie:
  // a Set-Cookie that differs in domain or path writes a second cookie rather
  // than replacing the first.
  jar.set(COOKIE_NAME, '', clearedCookieOptions());

  if (viewer) {
    await logAuthEvent({ event: 'sign_out', email: viewer.email, userId: viewer.id });
  }

  redirect('/');
}

// ── Change password ────────────────────────────────────────────────

export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // Unblocked: this is the one screen that stays reachable while
  // must_change_password is true.
  const viewer = await requireViewerUnblocked();

  const current = text(formData, 'current');
  const next = text(formData, 'next_password');
  const confirm = text(formData, 'confirm');

  const { rows } = await db.query<{ password_hash: string | null }>(
    `SELECT password_hash FROM identity.users WHERE id = $1 AND is_active`,
    [viewer.id],
  );
  const row = rows[0];
  if (!row) return { error: 'Your account is no longer active.' };

  // The current password is required even when the one they hold was issued
  // rather than chosen: they typed it a moment ago to get here, and asking
  // means a stolen session cookie cannot lock the owner out of their account.
  const currentMatches = await verifyPassword(current, row.password_hash);
  if (!currentMatches) return { error: 'That is not your current password.' };

  if (next !== confirm) return { error: 'The two new passwords do not match.' };
  if (next === current) return { error: 'That is the password you already have.' };

  const problem = passwordProblem(next);
  if (problem) return { error: problem };

  const passwordHash = await hashPassword(next);

  await db.query(
    `UPDATE identity.users
        SET password_hash = $2, must_change_password = false, updated_at = now()
      WHERE id = $1`,
    [viewer.id, passwordHash],
  );

  // The old token still claims mustChangePassword, and every portal will read
  // that claim eventually, so re-issue rather than leaving a stale one in place.
  const token = await issueToken({
    userId: viewer.id,
    email: viewer.email,
    name: viewer.name,
    mustChangePassword: false,
  });
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, cookieOptions());

  await logAuthEvent({
    event: 'password_changed',
    email: viewer.email,
    userId: viewer.id,
  });

  redirect('/');
}
