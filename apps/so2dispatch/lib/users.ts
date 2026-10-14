import bcrypt from "bcryptjs";
import {
  PAGE_SIZE,
  clampPage,
  likePattern,
  offsetFor,
  pageResult,
  type PageResult,
} from "@/lib/pagination";
import { query } from "@/lib/db";

import type { Role } from "@/lib/roles";

export type UserRole = Role;
export type UserStatus = "pending" | "approved" | "rejected" | "disabled";

export type User = {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  notifications_seen_at: string | null;
  // True when the user was issued a temporary password and must set their own
  // before using the app (enforced by the /risansi layout guard).
  must_change_password: boolean;
  // Sessions issued before this are refused — set by an admin password reset.
  sessions_valid_after: string | null;
  // A Rep's name as it appears on orders (orders.reps): the SOs they see.
  rep_name: string | null;
};

export type NewUser = {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
  /** A Rep's name as on orders. */
  repName?: string | null;
};

/** Error thrown when an email already has an account. */
export class EmailInUseError extends Error {
  constructor() {
    super("An account with this email already exists.");
    this.name = "EmailInUseError";
  }
}

const PUBLIC_COLUMNS =
  "id, full_name, email, role, status, created_at, updated_at, notifications_seen_at, must_change_password, sessions_valid_after, rep_name";

/**
 * Create a user with the given status. Throws EmailInUseError if the email is
 * already taken.
 */
export async function createUser(
  input: NewUser,
  status: UserStatus = "pending",
  // An admin-added account starts on the password the admin typed — a
  // temporary one the user must replace at first sign-in.
  opts: { mustChangePassword?: boolean } = {}
): Promise<User> {
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const result = await query<User>(
      `INSERT INTO users (full_name, email, password_hash, role, status, must_change_password, rep_name)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $4 = 'rep' THEN NULLIF($7, '') END)
       RETURNING ${PUBLIC_COLUMNS}`,
      [input.fullName.trim(), input.email.trim(), passwordHash, input.role, status, !!opts.mustChangePassword, (input.repName ?? "").trim()]
    );
    return result.rows[0];
  } catch (error) {
    // 23505 = unique_violation (case-insensitive email index)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new EmailInUseError();
    }
    throw error;
  }
}

/** Which reps already have an account, and which emails are taken — both lower-cased. */
export async function listAccountKeys(): Promise<{ repNames: Set<string>; emails: Set<string> }> {
  const result = await query<{ rep_name: string | null; email: string }>(
    `SELECT rep_name, email FROM users`
  );
  return {
    repNames: new Set(result.rows.map((r) => (r.rep_name ?? "").trim().toLowerCase()).filter(Boolean)),
    emails: new Set(result.rows.map((r) => r.email.trim().toLowerCase())),
  };
}

/** Create a user in 'pending' status (the "Request Access" flow). */
export function createPendingUser(input: NewUser): Promise<User> {
  return createUser(input, "pending");
}

/** All users, newest first. */
export async function listAllUsers(): Promise<User[]> {
  const result = await query<User>(
    `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at DESC`
  );
  return result.rows;
}

/**
 * How a user came to be, and who last decided their access — read off the
 * audit log, which recorded both from the start, so users added before this
 * column existed have it too. Null where the log has nothing (the platform
 * admin, seeded rather than added).
 */
export type UserProvenance = {
  /** "added" by an admin, or "requested" through the sign-up form. */
  origin: "added" | "requested" | null;
  origin_by: string | null;
  origin_at: string | null;
  /** The latest access decision: approved, rejected, disabled, pending. */
  review: string | null;
  review_by: string | null;
  review_at: string | null;
};

export type UserListRow = User & UserProvenance;

const ISO_FMT = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

/** The provenance columns for a `users` row aliased `u`. */
const PROVENANCE_SQL = `
        origin.kind AS origin,
        origin.by_name AS origin_by,
        to_char(origin.at AT TIME ZONE 'UTC', ${ISO_FMT}) AS origin_at,
        review.kind AS review,
        review.by_name AS review_by,
        to_char(review.at AT TIME ZONE 'UTC', ${ISO_FMT}) AS review_at`;

const PROVENANCE_JOINS = `
       LEFT JOIN LATERAL (
         SELECT CASE a.action WHEN 'user.create' THEN 'added' ELSE 'requested' END AS kind,
                -- Whoever acted, by name where they still have an account.
                CASE WHEN a.action = 'user.create'
                     THEN COALESCE((SELECT x.full_name FROM users x
                                     WHERE lower(x.email) = lower(a.user_email) LIMIT 1),
                                   a.user_email)
                END AS by_name,
                a.created_at AS at
           FROM audit_log a
          WHERE a.category = 'ownership'
            AND lower(a.target) = lower(u.email)
            AND a.action IN ('user.create', 'access.request')
          ORDER BY a.created_at ASC
          LIMIT 1
       ) origin ON TRUE
       LEFT JOIN LATERAL (
         SELECT substr(a.action, 6) AS kind,
                COALESCE((SELECT x.full_name FROM users x
                           WHERE lower(x.email) = lower(a.user_email) LIMIT 1),
                         a.user_email) AS by_name,
                a.created_at AS at
           FROM audit_log a
          WHERE a.category = 'ownership'
            AND lower(a.target) = lower(u.email)
            AND a.action IN ('user.approved', 'user.rejected', 'user.disabled', 'user.pending')
          ORDER BY a.created_at DESC
          LIMIT 1
       ) review ON TRUE`;

/**
 * One page of users, filtered in SQL. Status counts come back with it so
 * the tabs can show totals for the whole table, not just this page.
 */
export async function listUsersPage(opts: {
  page: number;
  status: string;
  search: string;
}): Promise<PageResult<UserListRow> & { counts: Record<string, number> }> {
  const status = opts.status === "all" ? null : opts.status;
  const search = opts.search ? likePattern(opts.search) : null;

  const where = `WHERE ($1::text IS NULL OR status = $1)
        AND ($2::text IS NULL OR full_name ILIKE $2 OR email ILIKE $2
                              OR role ILIKE $2)`;

  const [totals, counts] = await Promise.all([
    query<{ count: string }>(
      `SELECT count(*) AS count FROM users ${where}`,
      [status, search]
    ),
    // Tab counts ignore the status filter but respect the search, so the
    // numbers match what clicking each tab would actually show.
    query<{ status: string; count: string }>(
      `SELECT status, count(*) AS count FROM users
        WHERE ($1::text IS NULL OR full_name ILIKE $1 OR email ILIKE $1
                                OR role ILIKE $1)
        GROUP BY status`,
      [search]
    ),
  ]);

  const total = Number(totals.rows[0]?.count ?? 0);
  const page = clampPage(opts.page, total);
  const columns = PUBLIC_COLUMNS.split(",").map((c) => `u.${c.trim()}`).join(", ");
  const rows = await query<UserListRow>(
    `SELECT ${columns}, ${PROVENANCE_SQL}
       FROM (SELECT * FROM users ${where}
              ORDER BY created_at DESC
              LIMIT $3 OFFSET $4) u
       ${PROVENANCE_JOINS}
      ORDER BY u.created_at DESC`,
    [status, search, PAGE_SIZE, offsetFor(page)]
  );

  const byStatus: Record<string, number> = { all: 0 };
  for (const row of counts.rows) {
    byStatus[row.status] = Number(row.count);
    byStatus.all += Number(row.count);
  }

  return {
    ...pageResult(rows.rows, total, page),
    counts: byStatus,
  };
}

/**
 * Change a user's name, email and role together. Throws EmailInUseError when
 * the email already belongs to another account (the unique index is
 * case-insensitive, so "Jane@x.com" and "jane@x.com" collide).
 */
export async function updateUserDetails(
  id: string,
  details: { fullName: string; email: string; role: UserRole; repName?: string | null }
): Promise<void> {
  try {
    await query(
      // Only a Rep carries a rep name.
      `UPDATE users SET full_name = $2, email = $3, role = $4,
              rep_name = CASE WHEN $4 = 'rep' THEN NULLIF($5, '') END
        WHERE id = $1`,
      [id, details.fullName.trim(), details.email.trim(), details.role, (details.repName ?? "").trim()]
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new EmailInUseError();
    }
    throw error;
  }
}

/**
 * An admin reset: put the account on a temporary password the user must
 * replace at their next sign-in, and end every session they already have —
 * whoever holds one, it was issued before this moment.
 */
export async function resetToTemporaryPassword(
  id: string,
  temporaryPassword: string
): Promise<void> {
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  await query(
    `UPDATE users
        SET password_hash = $2,
            must_change_password = true,
            sessions_valid_after = now()
      WHERE id = $1`,
    [id, passwordHash]
  );
}

/** Delete a user. */
export async function deleteUser(id: string): Promise<void> {
  await query(`DELETE FROM users WHERE id = $1`, [id]);
}

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" | "pending" | "rejected" | "disabled" };

/**
 * Verify an email + password against the DB.
 * Returns the (public) user only when credentials match AND the account is
 * approved; otherwise reports why so the UI can show the right message.
 */
export async function verifyCredentials(
  email: string,
  password: string
): Promise<AuthResult> {
  const result = await query<User & { password_hash: string }>(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users
     WHERE lower(email) = lower($1)
     LIMIT 1`,
    [email.trim()]
  );

  const row = result.rows[0];
  // Compare even when no row is found to avoid leaking which emails exist.
  const hash = row?.password_hash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv";
  const passwordMatches = await bcrypt.compare(password, hash);

  if (!row || !passwordMatches) return { ok: false, reason: "invalid" };
  if (row.status !== "approved") return { ok: false, reason: row.status };

  const { password_hash: _hash, ...user } = row;
  return { ok: true, user };
}

/** Fetch a single user by id, or null if not found. */
/**
 * The account linked to a Risansi Digital identity (users.identity_user_id),
 * or null when nobody here is linked to it yet. Throws while the column does
 * not exist — before the Phase 5 migration is applied — which the shared
 * session reader treats as "not settled here".
 */
export async function getUserByIdentityId(identityUserId: string): Promise<User | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identityUserId)) return null;
  const result = await query<User>(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE identity_user_id = $1`,
    [identityUserId]
  );
  return result.rows[0] ?? null;
}

/**
 * Create the account for somebody approved at Risansi Digital who has no row
 * here yet (Phase 5, step 5): name and email from the shared session, role
 * from the grant, approved, linked by identity_user_id.
 *
 * They have no local password, but password_hash is NOT NULL: it holds the
 * bcrypt hash of a random uuid that is thrown away — the right shape and
 * impossible to match, so nothing else needs a special case.
 *
 * The email may already belong to an account here that the seed did not
 * link. ON CONFLICT targets lower(email) — the unique index this table
 * actually has; targeting email fails at runtime — and links that account
 * instead, leaving its id, password and history alone. One already linked to
 * a different identity is never taken over: null, and the caller refuses.
 */
export async function createLinkedUser(input: {
  identityUserId: string;
  fullName: string;
  email: string;
  role: UserRole;
}): Promise<User | null> {
  const passwordHash = await bcrypt.hash(crypto.randomUUID(), 12);
  const result = await query<User>(
    `INSERT INTO users (full_name, email, password_hash, role, status, must_change_password, identity_user_id)
     VALUES ($1, $2, $3, $4, 'approved', false, $5)
     ON CONFLICT (lower(email)) DO UPDATE
        SET identity_user_id = EXCLUDED.identity_user_id, updated_at = now()
      WHERE users.identity_user_id IS NULL
     RETURNING ${PUBLIC_COLUMNS}`,
    [input.fullName.trim() || input.email.trim(), input.email.trim(), passwordHash, input.role, input.identityUserId]
  );
  // Nothing returned: the email's account is linked already — to this
  // identity if a second request raced us here, otherwise to someone else.
  return result.rows[0] ?? (await getUserByIdentityId(input.identityUserId));
}

/** Until when to skip asking for the link because the column is not there yet. */
let identityColumnMissingUntil = 0;

/**
 * The Risansi Digital identity an account is linked to (users.identity_user_id),
 * or null. Null too while the column does not exist — before the Phase 5
 * migration is applied — and then not asked again for a minute, so every
 * request does not pay for a failing query.
 */
export async function getIdentityLink(userId: string): Promise<string | null> {
  if (Date.now() < identityColumnMissingUntil) return null;
  try {
    const result = await query<{ identity_user_id: string | null }>(
      `SELECT identity_user_id FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows[0]?.identity_user_id ?? null;
  } catch (error) {
    if (/identity_user_id/.test(error instanceof Error ? error.message : String(error))) {
      identityColumnMissingUntil = Date.now() + 60_000;
      return null;
    }
    throw error;
  }
}

export async function getUserById(id: string): Promise<User | null> {
  const result = await query<User>(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/** Verify a password for a given user id (used by "change password"). */
export async function verifyPasswordById(
  id: string,
  password: string
): Promise<boolean> {
  const result = await query<{ password_hash: string }>(
    `SELECT password_hash FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  const hash = result.rows[0]?.password_hash;
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

/**
 * Update a user's password (hashes before storing). Always clears the
 * must_change_password flag — once someone sets their own password, the
 * forced-change requirement is satisfied.
 */
export async function updatePassword(
  id: string,
  newPassword: string
): Promise<void> {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await query(
    `UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1`,
    [id, passwordHash]
  );
}

/** Mark the moment a user last opened their notification bell (clears unread). */
export async function markNotificationsSeen(id: string): Promise<void> {
  await query(`UPDATE users SET notifications_seen_at = now() WHERE id = $1`, [id]);
}

/** List users with the given status, newest first. */
export async function listUsersByStatus(status: UserStatus): Promise<User[]> {
  const result = await query<User>(
    `SELECT ${PUBLIC_COLUMNS} FROM users
     WHERE status = $1
     ORDER BY created_at DESC`,
    [status]
  );
  return result.rows;
}

/** Approved users of one role, by name — for pickers. */
export async function listApprovedUsersByRole(role: string): Promise<{ id: string; full_name: string; email: string }[]> {
  const result = await query<{ id: string; full_name: string; email: string }>(
    `SELECT id, full_name, email FROM users
      WHERE role = $1 AND status = 'approved'
      ORDER BY lower(full_name)`,
    [role]
  );
  return result.rows;
}

/** Count of pending access requests. */
export async function countPending(): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*) AS count FROM users WHERE status = 'pending'`
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Set a user's status. The platform admin account is protected at the action
 * layer (it must never be locked out).
 */
export async function setUserStatus(
  id: string,
  status: UserStatus
): Promise<void> {
  await query(`UPDATE users SET status = $2 WHERE id = $1`, [id, status]);
}
