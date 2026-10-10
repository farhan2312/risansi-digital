/**
 * Who is asking, resolved on every request.
 *
 * The session token says who you are and nothing else — no role, no grants
 * (see packages/identity/src/session.ts). So the row is re-read here on each
 * request, which is what keeps the sales portal's one good property: taking
 * somebody's access away lands on their next click rather than whenever an
 * eight-hour token happens to expire.
 *
 * `cache()` dedupes that read within a single request, so a page and the
 * header it renders cost one query between them, not two.
 *
 * This is the enforcement point. The docs call it a Data Access Layer and are
 * explicit that proxy checks are optimistic rather than authoritative
 * (node_modules/next/dist/docs/01-app/02-guides/authentication.md,
 * "Optimistic checks with Proxy"), so every page and every Server Function in
 * this app starts by calling one of these.
 */

import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import { COOKIE_NAME, readToken } from '@risansi/identity';
import db from '@/lib/db';

export type HubRole = 'member' | 'approver';

export interface Viewer {
  id: string;
  email: string;
  name: string;
  /** The hub's own role. 'approver' may decide access requests, nothing more. */
  role: HubRole;
  mustChangePassword: boolean;
}

/**
 * The signed-in person, or null.
 *
 * Null covers every "not signed in" shape there is: no cookie, a cookie that
 * does not verify, a token for a row that has since been deleted, and a row
 * with `is_active = false`. That last one is the point of doing this read at
 * all — an inactive user is refused everywhere, so it is answered here once
 * rather than in each page.
 */
export const getViewer = cache(async function getViewer(): Promise<Viewer | null> {
  const jar = await cookies();
  const session = await readToken(jar.get(COOKIE_NAME)?.value);
  if (!session) return null;

  const { rows } = await db.query<{
    id: string; email: string; name: string;
    role: HubRole; must_change_password: boolean;
  }>(
    `SELECT id, email, name, role, must_change_password
       FROM identity.users
      WHERE id = $1 AND is_active`,
    [session.userId],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    mustChangePassword: row.must_change_password,
  };
});

/**
 * The signed-in person, or away to sign in.
 *
 * Also sends anyone holding an issued password to the change-password screen
 * first: that screen is the only thing reachable until they have chosen one.
 */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect('/sign-in');
  if (viewer.mustChangePassword) redirect('/change-password');
  return viewer;
}

/**
 * For the change-password screen itself, which must stay reachable while
 * `must_change_password` is true — otherwise it would redirect to itself.
 */
export async function requireViewerUnblocked(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect('/sign-in');
  return viewer;
}

/**
 * An approver, or a 404.
 *
 * 404 rather than 403 on purpose: a member who guesses the URL learns nothing
 * about whether the page is there. The header link to it is not rendered for
 * them either, but a missing link is a courtesy and this is the boundary.
 *
 * Every Server Function behind /requests calls this too. A hidden button is
 * not a permission check — Server Functions are reachable by direct POST.
 */
export async function requireApprover(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.role !== 'approver') notFound();
  return viewer;
}

/** How many grants are waiting on a decision. Approver-facing only. */
export async function pendingGrantCount(): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM identity.app_grants WHERE status = 'Pending'`,
  );
  return Number(rows[0]?.n ?? 0);
}
