/**
 * Risansi Digital, the hub — where signing in, signing up and passwords live
 * since this portal's own login was retired (Phase 5, step 7).
 *
 * `next` is where to come back to. The hub checks it with safeReturnUrl()
 * and this portal deliberately does not: two checks in two codebases drift
 * apart, and the hub's is the one that decides.
 */
export const HUB_URL = (process.env.HUB_URL || "https://digital.risansi.com").replace(/\/+$/, "");

export function hubSignInUrl(next?: string): string {
  return next ? `${HUB_URL}/sign-in?next=${encodeURIComponent(next)}` : `${HUB_URL}/sign-in`;
}

export const HUB_CHANGE_PASSWORD_URL = `${HUB_URL}/change-password`;
export const HUB_SIGN_UP_URL = `${HUB_URL}/sign-up`;
export const HUB_SIGN_OUT_URL = `${HUB_URL}/sign-out`;

/** The sentence a retired form answers with: the old address, gone, and the new one. */
export const MOVED_TO_HUB = `Signing in and passwords have moved to Risansi Digital: ${HUB_URL}`;
