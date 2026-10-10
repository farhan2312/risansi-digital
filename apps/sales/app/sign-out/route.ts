/**
 * POST /sign-out — clears both session cookies and sends you to the hub.
 *
 * A Route Handler and a plain HTML form, deliberately, rather than the Server
 * Action this started as. The action wrote the same two cookies and ended in
 * `redirect()` to another origin; in production that answered a 500 on the
 * POST, and the sign-out path is the wrong place to be clever. A form POST to
 * a route that answers 303 is ordinary HTTP with nothing between the browser
 * and the response — no action id, no RSC payload, no client router deciding
 * what a cross-origin redirect means.
 *
 * Not a GET. A URL that signs you out can be fired by anything that can make
 * your browser issue a request, an <img> in an email included. That is an
 * annoyance rather than a breach, but it is free to do properly, so this is a
 * POST with an Origin check — the hub's own sign-out makes the same call.
 *
 * Two cookies, because step 4 left two in play:
 *
 *   risansi_session          issued by the hub, scoped to .risansi.com
 *   next-auth.session-token  issued here before step 4, host-only
 *
 * Clearing one and not the other is what the old Sign out button did, and it
 * meant anybody who signed in through the hub — by now everybody — was waved
 * straight back in by the cookie that survived.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME, clearedCookieOptions } from '@risansi/identity';

const HUB = (process.env.HUB_URL || 'https://digital.risansi.com').replace(/\/+$/, '');

/**
 * The scope the hub set the shared cookie with.
 *
 * A Set-Cookie that differs in domain writes a *second* cookie rather than
 * replacing the first, so clearing a `.risansi.com` cookie with a host-only
 * one leaves the original in place and the person still signed in. The env
 * var is the answer when it is set; when it is not — and it is not set on
 * sales today — the parent of the request's own host is the same answer, and
 * deriving it beats a sign-out that silently does nothing.
 *
 * Left undefined on a preview deployment: `something.vercel.app` would derive
 * `.vercel.app`, which is a public suffix and which browsers refuse outright,
 * taking the host-only clear down with it. Previews do not set a domain-scoped
 * cookie in the first place (see packages/identity/src/session.ts).
 */
function sharedCookieDomain(host: string | null): string | undefined {
  const explicit = process.env.RISANSI_COOKIE_DOMAIN;
  if (explicit) return explicit;

  const name = (host ?? '').split(':')[0]!.toLowerCase();
  if (!name || name.endsWith('.vercel.app')) return undefined;

  const labels = name.split('.');
  // Fewer than three labels means there is no parent to widen to, and an IP
  // address or `localhost` has no cookie domain worth setting.
  if (labels.length < 3 || /^[\d.]+$/.test(name)) return undefined;
  return `.${labels.slice(1).join('.')}`;
}

export async function POST(req: NextRequest) {
  const host = req.headers.get('host');

  // Same-origin only. A form in this app always sends an Origin on a POST;
  // something that does not is not this app's sign-out button.
  const origin = req.headers.get('origin');
  let sameOrigin = false;
  try {
    sameOrigin = !!origin && new URL(origin).host === host;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) {
    return NextResponse.json({ error: 'Sign out must be posted from the portal.' }, { status: 403 });
  }

  // 303, so the browser follows it with a GET. A 307 would repeat the POST at
  // the hub's sign-in page.
  const res = NextResponse.redirect(`${HUB}/sign-in`, 303);

  const domain = sharedCookieDomain(host);
  res.cookies.set(COOKIE_NAME, '', { ...clearedCookieOptions(), ...(domain ? { domain } : {}) });

  // Host-only, both spellings: next-auth picks the __Secure- prefix when
  // NEXTAUTH_URL is https. Clearing one that was never set costs nothing, and
  // this stops mattering at step 5 when next-auth goes.
  const secure = process.env.NODE_ENV === 'production';
  for (const name of ['next-auth.session-token', '__Secure-next-auth.session-token']) {
    res.cookies.set(name, '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 });
  }

  return res;
}
