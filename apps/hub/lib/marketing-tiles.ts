/**
 * The four tiles as a signed-out visitor sees them.
 *
 * Copy, URLs and order are taken from the static index.html at the repo root,
 * so the front page of the hub reads identically whether or not anyone is
 * signed in.
 *
 * These are a constant rather than a query on purpose. The landing page is the
 * first thing anyone hits and it has nothing to personalise, so it should not
 * depend on the identity database being reachable — or, right now, on it
 * existing at all. Once somebody signs in, `tilesFor()` takes over and the
 * database is the only source: name, url and blurb all come from
 * `identity.apps`, and these strings stop being read.
 */

export interface MarketingTile {
  slug: string;
  name: string;
  url: string;
  blurb: string;
}

export const MARKETING_TILES: MarketingTile[] = [
  {
    slug: 'sales',
    name: 'Sales Portal',
    url: 'https://sales.risansi.com',
    blurb: 'Manage leads, clients, and the full opportunity pipeline — from first enquiry to won order.',
  },
  {
    slug: 'select',
    name: 'Pump Selection',
    url: 'https://select.risansi.com',
    blurb: 'Find the right pump for every duty point — head, flow, and efficiency matched in seconds.',
  },
  {
    slug: 'testing',
    name: 'Testing Portal',
    url: 'https://rndtesting.risansi.com',
    blurb: 'Record, track, and certify pump performance tests with a complete digital test log.',
  },
  {
    slug: 'so2dispatch',
    name: 'SO to Dispatch',
    url: 'https://so2dispatch.risansi.com',
    blurb: 'Track every sales order from booking through production to dispatch — end to end.',
  },
];

/** `sales.risansi.com` from `https://sales.risansi.com`, for the tile footer. */
export function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** `4` becomes `04`, for the "Solutions · 04" label. */
export function twoDigit(n: number): string {
  return String(n).padStart(2, '0');
}

/** The 01–04 numbering the static page carries, from a zero-based index. */
export function tileNumber(index: number): string {
  return twoDigit(index + 1);
}
