/**
 * Reading the shared Risansi Digital session, alongside NextAuth.
 *
 * Phase 3 step 1 of MIGRATION_PLAN.md. **Nothing in this file is authoritative
 * yet.** NextAuth remains the thing that decides who is signed in; this exists
 * so the shared cookie can be observed reaching this app, and verified here,
 * before step 3 makes it primary. If it is wrong, nobody is affected.
 *
 * The cookie is set by the hub at `digital.risansi.com`, scoped to
 * `.risansi.com`, which is why this app can see it at all. Verification needs
 * `RISANSI_SESSION_SECRET` to match the hub's exactly — the same string, not
 * an equivalent one.
 *
 * Version skew is deliberate and checked. `@risansi/identity` declares jose 6
 * and this app resolves jose 5, because next-auth's tree brought one along
 * first. A token signed by the hub under 6 was verified here under 5 before
 * this file was written; HS256 is a standard and the two interoperate. Noted
 * because "it is only a JWT" is exactly the assumption worth testing once, in
 * the one place where being wrong means nobody can sign in.
 */

import { cookies } from 'next/headers';
import { COOKIE_NAME, readToken, type Session } from '@risansi/identity';

/**
 * The shared session, or null.
 *
 * Null covers every ordinary case — no cookie, expired, wrong issuer, signed
 * with a different secret — because the caller's question is only ever "is
 * there a valid one". A missing secret still throws, from inside the identity
 * package, because that is a deployment fault and must not read as "nobody is
 * signed in".
 */
export async function readSharedSession(): Promise<Session | null> {
  const jar = await cookies();
  return readToken(jar.get(COOKIE_NAME)?.value);
}

/** What the shared cookie looks like from in here. For the step-1 check only. */
export interface SharedSessionDiagnosis {
  /** Is the secret even configured in this app? */
  secretConfigured: boolean;
  /** Did the browser send the cookie to this subdomain? */
  cookiePresent: boolean;
  /** Did it verify against our copy of the secret? */
  verifies: boolean;
  identityUserId: string | null;
  sharedEmail: string | null;
  /** What NextAuth currently thinks, for comparison. */
  nextAuthEmail: string | null;
  /**
   * Do the two agree on who this is? The question step 3 turns on: if these
   * disagree for anybody, switching the primary would sign them in as
   * somebody else.
   */
  agree: boolean | null;
  note: string;
}

export async function diagnoseSharedSession(nextAuthEmail: string | null): Promise<SharedSessionDiagnosis> {
  const secretConfigured = Boolean(process.env.RISANSI_SESSION_SECRET);
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value ?? null;

  if (!secretConfigured) {
    return {
      secretConfigured: false, cookiePresent: Boolean(raw), verifies: false,
      identityUserId: null, sharedEmail: null, nextAuthEmail, agree: null,
      note: 'RISANSI_SESSION_SECRET is not set in this app, so no shared session can be read here. '
        + 'It must be the same string the hub signs with.',
    };
  }
  if (!raw) {
    return {
      secretConfigured: true, cookiePresent: false, verifies: false,
      identityUserId: null, sharedEmail: null, nextAuthEmail, agree: null,
      note: 'No shared cookie reached this subdomain. Either nobody is signed in at the hub, or the '
        + "hub's RISANSI_COOKIE_DOMAIN is not '.risansi.com' with the leading dot.",
    };
  }

  const session = await readSharedSession();
  if (!session) {
    return {
      secretConfigured: true, cookiePresent: true, verifies: false,
      identityUserId: null, sharedEmail: null, nextAuthEmail, agree: null,
      note: 'The cookie arrived but did not verify: a different secret, an expired token, or a '
        + 'different issuer. Compare RISANSI_SESSION_SECRET here against the hub, exactly.',
    };
  }

  const agree = nextAuthEmail
    ? session.email.toLowerCase() === nextAuthEmail.toLowerCase()
    : null;

  return {
    secretConfigured: true, cookiePresent: true, verifies: true,
    identityUserId: session.userId,
    sharedEmail: session.email,
    nextAuthEmail,
    agree,
    note: agree === false
      ? 'BOTH sessions are valid and they are DIFFERENT people. Do not proceed to step 3 until this '
        + 'is understood — switching the primary would sign somebody in as somebody else.'
      : agree === null
        ? 'Shared session verified. No NextAuth session to compare it against.'
        : 'Shared session verified and it agrees with NextAuth. This is what step 3 needs.',
  };
}
