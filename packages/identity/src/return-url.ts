/**
 * Where it is safe to send somebody after they sign in.
 *
 * Needed because of how the hub works: a link to a portal, from an old
 * notification email or an Excel export, hits that portal while signed out.
 * The portal bounces to the hub carrying where the person was going, and the
 * hub sends them back there afterwards. Without the round trip they land on the
 * hub's front page and have to go find the complaint they were sent — which is
 * the behaviour the sales portal has today, since its `proxy.ts` redirects to
 * the sign-in page with no return URL at all.
 *
 * With the round trip, `?next=` on a login page is a phishing hop if it is not
 * checked: the attacker sends `digital.risansi.com/sign-in?next=https://evil.example/`,
 * the victim reads the real domain, signs in, and is handed straight to the
 * attacker's page still believing they are inside Risansi. So the destination
 * is checked against a list and anything else is discarded silently.
 */

/**
 * Hosts we will hand a signed-in person to. Suffix matching is on `.risansi.com`
 * with the leading dot, which is what makes `risansi.com.evil.example` fail —
 * it does not end with `.risansi.com`, it ends with `.evil.example`.
 */
const ALLOWED_SUFFIX = '.risansi.com';
const ALLOWED_EXACT = new Set(['risansi.com']);

function devHost(host: string): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}

/**
 * Returns a destination that is safe to redirect to, or the fallback.
 *
 * A relative path is allowed and returned as-is: the hub redirecting inside
 * itself is the common case and carries no cross-origin risk. Anything with a
 * scheme or an authority has to survive the host check.
 */
export function safeReturnUrl(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback;

  // A protocol-relative URL looks relative and is not: `//evil.example` means
  // the same scheme, different host. Reject before the relative-path branch.
  if (raw.startsWith('//')) return fallback;

  // Backslashes are treated as slashes by some parsers, so `/\evil.example`
  // can leave an origin even though it starts with a slash.
  if (raw.includes('\\')) return fallback;

  if (raw.startsWith('/')) return raw;

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return fallback;
  }

  // Only the two schemes a browser should follow here. This is what rejects
  // `javascript:`, `data:` and the rest.
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return fallback;

  // Credentials in a URL are how `https://sales.risansi.com@evil.example/`
  // is made to look trustworthy. The parser already reports the real host, but
  // refuse them outright rather than render something that misleads.
  if (u.username || u.password) return fallback;

  // `hostname` is punycode for an internationalised domain, so a lookalike
  // built from Cyrillic characters cannot match the ASCII suffix below.
  const host = u.hostname.toLowerCase();
  const allowed = ALLOWED_EXACT.has(host) || host.endsWith(ALLOWED_SUFFIX) || devHost(host);
  if (!allowed) return fallback;

  // http is fine on a dev host, never on a real one — sending a session cookie
  // over plaintext defeats the point of having marked it Secure.
  if (u.protocol === 'http:' && !devHost(host)) return fallback;

  return u.toString();
}

/** True when `safeReturnUrl` would keep this destination. For tests and logs. */
export function isSafeReturnUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return safeReturnUrl(raw, '\u0000rejected') !== '\u0000rejected';
}
