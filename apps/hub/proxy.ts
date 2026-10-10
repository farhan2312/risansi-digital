/**
 * Security headers, and a per-request nonce for the Content-Security-Policy.
 *
 * Next 16 renamed the `middleware` file convention to `proxy`; the
 * `middleware` export is deprecated. See
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
 * and `apps/sales/proxy.ts`, which does the same job for access control there.
 *
 * ── This is NOT an access gate ────────────────────────────────────
 *
 * The hub decides who may see what in `lib/viewer.ts`, which re-reads the user
 * row per request. That distinction is the lesson from the sales portal, where
 * `proxy.ts` tested a value it believed was live and was not: `withAuth` reads
 * the cookie through `getToken()`, which decodes it without running the jwt
 * callback, so a deactivated person walked past the gate until their cookie
 * was next re-issued. Nothing here reads the session at all, so there is no
 * second, staler copy of the rules to drift.
 *
 * ── Why a nonce rather than 'unsafe-inline' ───────────────────────
 *
 * The sales portal's policy carries `script-src 'self' 'unsafe-inline'`,
 * with a comment explaining that Next injects unnonced inline bootstrap
 * scripts. That is a real constraint and it guts the directive: once inline
 * script is allowed wholesale, an injected `<script>` runs, which is most of
 * what a CSP is for.
 *
 * Next does support nonces. It parses the `Content-Security-Policy` on the
 * REQUEST, lifts the `'nonce-…'` value out of it, and attaches that nonce to
 * every script it emits — framework, chunks, and the inline flight data. It
 * only works for dynamically rendered pages, because a static page is built
 * before any request exists, and every route in this app is already dynamic:
 * each one reads the session cookie before it queries anything.
 *
 * The one script Next does not know about is the theme script in
 * `app/layout.tsx`, which runs before first paint so the page does not flash
 * the wrong colour. It reads the nonce from the `x-nonce` header set below.
 *
 * `style-src` needs no `'unsafe-inline'` either: this app has zero inline
 * `style={{…}}` attributes — all of its colour lives in CSS custom properties
 * in a stylesheet — so there is nothing for the browser to refuse.
 */

import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  const csp = [
    `default-src 'self'`,
    // 'strict-dynamic' lets a script this nonce trusts load further scripts,
    // which is how Next loads its chunks. 'unsafe-eval' is a development-only
    // concession to hot reloading and must never reach production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Production gets the nonce. Development gets 'unsafe-inline' INSTEAD —
    // not as well, because a nonce makes browsers ignore 'unsafe-inline'
    // entirely, so listing both would leave dev exactly as strict as prod.
    //
    // Next's dev tooling sets element styles through the CSSOM while hot
    // reloading, which a nonce cannot cover: there is no tag to put it on.
    // Under the strict policy that produced 106 blocked-style errors on a
    // single page load, which is not a security finding — it is a wall of
    // noise with any real error buried in it. Verified that the strict policy
    // is clean against a production build before relaxing this.
    isDev ? `style-src 'self' 'unsafe-inline'` : `style-src 'self' 'nonce-${nonce}'`,
    // next/font self-hosts the two IBM Plex faces, so no Google origin is
    // needed here — unlike the static index.html, which pulled them from
    // fonts.googleapis.com.
    `font-src 'self'`,
    `img-src 'self' data: blob:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    // Every form on this site posts back to it. Worth stating: without it, an
    // injected <form> could point the sign-in fields at somebody else's server.
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  // On the REQUEST so Next can read the nonce out of it while rendering, and
  // on the RESPONSE so the browser actually enforces it. Both are required.
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);

  const res = NextResponse.next({ request: { headers } });

  res.headers.set('Content-Security-Policy', csp);
  // X-Frame-Options is superseded by frame-ancestors and kept for older
  // browsers that honour one and not the other.
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Two years, subdomains included. The session cookie is scoped to
  // .risansi.com, so any subdomain served over plain http is a place that
  // cookie could be read in transit.
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  // The hub needs no device capability at all. Sales allows geolocation for
  // visit check-ins; nothing here does anything of the kind.
  res.headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');

  return res;
}

export const config = {
  matcher: [
    {
      // Static assets and the image optimiser need no policy, and a prefetch
      // is not a document — handing those a fresh nonce each time only
      // defeats caching.
      source: '/((?!_next/static|_next/image|favicon.ico|assets/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
