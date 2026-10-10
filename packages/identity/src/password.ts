/**
 * Passwords.
 *
 * bcrypt at cost 10, matching what the sales portal already uses in
 * `resetUserPassword` and its sign-up route. That matters for Phase 3: when
 * sales users are seeded into `identity.users`, their existing hashes can be
 * carried across verbatim and still verify — no forced reset for people who
 * only ever had the one account.
 *
 * (People with accounts in several portals are a different matter. Their
 * passwords differ per portal, so there is no correct one to keep, and the
 * decision was to force a reset rather than quietly pick a winner. See §2.4 of
 * MIGRATION_PLAN.md.)
 */

import bcrypt from 'bcryptjs';

const COST = 10;

/** Deliberately generous: length is what actually helps, so do not cap it low. */
export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(plain: string): Promise<string> {
  const problem = passwordProblem(plain);
  if (problem) throw new Error(problem);
  return bcrypt.hash(plain, COST);
}

/**
 * Compare, and never leak which half was wrong.
 *
 * A missing hash — an account that has never had a password set — compares
 * against a dummy so the wrong-email and no-password-yet paths take the same
 * time as a wrong password. Returning early instead would let someone tell
 * which addresses exist by watching how fast the answer comes back.
 */
const DUMMY = '$2a$10$ewH5Sm0IYlJBd/VAqxqX/eSCmYmA30rUT/6zyLnCXuULhGvGnLd1y';
export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) { await bcrypt.compare(plain, DUMMY); return false; }
  return bcrypt.compare(plain, hash);
}

/**
 * Why a password is not acceptable, or null.
 *
 * Returns the sentence rather than a boolean because the person typing needs to
 * read it. The rules are modest on purpose — a long list of character classes
 * pushes people toward `Risansi123456!` and a sticky note. Length, and a check
 * against the handful of things people here actually type.
 */
export function passwordProblem(plain: string): string | null {
  if (!plain || plain.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. Length helps more than symbols do.`;
  }
  if (plain.length > 200) return 'That is longer than 200 characters.';
  const flat = plain.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (flat.includes('risansi')) {
    return 'Pick something that does not contain "risansi" — it is the first thing anyone would try.';
  }
  if (/^(.)\1+$/.test(flat)) return 'That is one character repeated.';
  if (/^(0123456789|1234567890|123456|password|qwerty|abcdef)/.test(flat)) {
    return 'That is one of the most commonly used passwords. Pick something else.';
  }
  return null;
}
