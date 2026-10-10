// The portal's public origin, and the one place that turns an in-app path into
// an address that works outside the app.
//
// Deliberately NOT NEXTAUTH_URL or VERCEL_URL: those resolve to the internal
// deployment host, which is fine for a redirect during a request but useless in
// an email or a spreadsheet a client opens next week. Override with APP_URL.
export const APP_URL = (process.env.APP_URL || 'https://sales.risansi.com').replace(/\/+$/, '');

/** Build an absolute portal link from a path. */
export const appLink = (path: string) => `${APP_URL}${path.startsWith('/') ? path : '/' + path}`;

/**
 * Make a stored link openable from outside the app.
 *
 * opportunities.quotation_link holds three shapes: an in-app path (an uploaded
 * document), a full external url (a link typed in before uploads existed), and
 * a handful of bare filenames from an early import. Only the first needs the
 * origin; the second is already absolute; the third is not a url at all and is
 * returned untouched rather than dressed up as one that would 404.
 */
export function absoluteLink(stored: string | null | undefined): string {
  const v = (stored ?? '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/')) return appLink(v);
  return v;
}
