/**
 * @risansi/identity — one session for every Risansi portal.
 *
 * Imported by the hub, which issues sessions, and eventually by each portal,
 * which only verifies them. See MIGRATION_PLAN.md §3.
 *
 * Nothing here opens a database connection or reads a request. The query
 * functions take a client, and session reading takes a token string, so the
 * same package works in a Next route handler, a proxy, and a test without any
 * of them agreeing on how a pool is built.
 */

export {
  type Session,
  COOKIE_NAME,
  SESSION_SECONDS,
  issueToken,
  readToken,
  cookieOptions,
  clearedCookieOptions,
} from './session.js';

export {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
  passwordProblem,
} from './password.js';

export {
  type GrantStatus,
  type Queryable,
  type AppTile,
  type AppRole,
  type TileState,
  tileState,
  rolesFor,
  allRoles,
  tilesFor,
  mayOpen,
  requestAccess,
} from './grants.js';

export { safeReturnUrl, isSafeReturnUrl } from './return-url.js';
