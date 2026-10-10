// Next.js 16 renamed the `middleware` file convention to `proxy` (the
// `middleware` export is deprecated). See node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/proxy.md. `proxy` runs on the Node.js
// runtime, which is what next-auth's getToken-based `withAuth` needs anyway.
import { withAuth } from 'next-auth/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Does this request carry a valid Risansi Digital session?
 *
 * Signature and issuer only — no database. The proxy's job is to turn away
 * somebody with no credentials at all; deciding what a credentialled person
 * may see costs a query and belongs where the query happens.
 *
 * Inlined rather than imported from @risansi/identity because this file runs
 * in the proxy, and `next/headers` — which that package's reader uses — is not
 * available here. Same cookie name, same secret, same issuer.
 */
async function sharedSessionIsValid(req: NextRequest): Promise<boolean> {
  const raw = req.cookies.get('risansi_session')?.value;
  const secret = process.env.RISANSI_SESSION_SECRET;
  if (!raw || !secret) return false;
  try {
    await jwtVerify(raw, new TextEncoder().encode(secret), { issuer: 'risansi-digital' });
    return true;
  } catch {
    return false;
  }
}


/** Every page prefix a `staff` user may open. Client 360 is read-only for them
 *  (nothing in the client write path accepts a non-admin), and the print view is
 *  the same client data they can already see on screen. */
const STAFF_PATHS = [
  '/risansi/clients',
  '/risansi/complaints',
  '/print/client',
];

const proxy = withAuth(
  async function proxy(req) {
    const token    = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // API callers get JSON they can act on; a browser gets sent somewhere it can
    // read. A link opened from a spreadsheet is a browser navigation to an /api
    // path, so the decision follows the Accept header rather than the prefix.
    const isApi = pathname.startsWith('/api/');
    const wantsHtml = (req.headers.get('accept') ?? '').includes('text/html');
    const deny = (status: number, message: string, to: string) =>
      (isApi && !wantsHtml)
        ? NextResponse.json({ error: message }, { status })
        : NextResponse.redirect(new URL(to, req.url));

    // Phase 3 step 3: a Risansi Digital session counts as signed in.
    //
    // withAuth only knows about NextAuth, so without this a person holding a
    // perfectly good shared session is bounced here and never reaches the
    // code that would have recognised it — which is exactly what happened the
    // first time this was tested.
    //
    // Verified, not trusted: `sharedSessionIsValid` checks the signature and
    // the issuer. It deliberately does NOT read the database. Whether that
    // person may open sales is decided by the sales grant, in
    // app/risansi/layout.tsx and getCurrentUser(), where the row is re-read
    // per request. Outer door here, lock there.
    const shared = !token && await sharedSessionIsValid(req);

    // Not logged in by either route → signin.
    if (!token && !shared) {
      return deny(401, 'Not signed in.', '/api/auth/signin');
    }

    // Everything below reads `token`, which a shared-session request does not
    // have. Those rules are enforced again downstream — the layout applies the
    // admin gates and the staff allowlist from the role it resolves itself,
    // which is the live one rather than whatever a cookie was carrying. So a
    // shared session passes here and is judged there.
    if (!token) {
      // The layout cannot see the URL on its own, so hand it over.
      const headers = new Headers(req.headers);
      headers.set('x-risansi-path', pathname);
      return NextResponse.next({ request: { headers } });
    }

    // Pending / Rejected / Revoked → blocked.
    //
    // This value can be STALE, and the comment here used to claim the
    // opposite. `withAuth` reads the cookie through getToken(), which decodes
    // it; it does not run the jwt callback. So `risansiAccess` is whatever was
    // written into the token the last time NextAuth issued one, not the live
    // row — and somebody deactivated mid-session passes this gate until their
    // cookie is next re-issued.
    //
    // It is still worth keeping: it is the cheap check that turns away the
    // common case without a database round trip. The authoritative one is
    // getCurrentUser(), which goes through getServerSession and does re-read
    // the row, and app/risansi/layout.tsx now refuses on that answer. Treat
    // this as the outer door and that as the lock.
    if (token.risansiAccess !== 'Approved') {
      return deny(403, 'Your access to the portal has been withdrawn.', '/api/auth/signup/pending');
    }

    // /admin → sysadmin only.
    if (pathname.startsWith('/admin') && token.role !== 'sysadmin') {
      return deny(403, 'Sysadmin only.', '/risansi');
    }

    // /risansi/admin/* → admin or sysadmin only.
    if (
      pathname.startsWith('/risansi/admin') &&
      !['admin', 'sysadmin'].includes(token.role as string)
    ) {
      return deny(403, 'Admins only.', '/risansi');
    }

    // Staff reach Client 360 and Complaints, and nothing else.
    //
    // An allowlist rather than a list of things to block: a role defined by the
    // two screens it may open should fail closed when a third screen is added,
    // not quietly inherit it. The auth helpers already refuse staff every
    // visit, opportunity and action record — this stops them landing on the
    // pages at all, so they get a redirect rather than a page of zeroes.
    //
    // /api/** is deliberately not filtered here: those handlers authorise
    // themselves through getCurrentUser, and the scope helpers answer FALSE for
    // staff on everything outside these two areas.
    if (token.role === 'staff' && !pathname.startsWith('/api/')) {
      const allowed = STAFF_PATHS.some(
        p => pathname === p || pathname.startsWith(`${p}/`),
      );
      if (!allowed) return deny(403, 'Not available for your role.', '/risansi/complaints');
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // Always run the function above. Returning false here would make next-auth
      // redirect to the sign-in PAGE, which is the wrong answer for an API call —
      // deny() needs to decide between JSON and a redirect itself.
      authorized: () => true,
    },
  },
);

export default proxy;

export const config = {
  matcher: [
    '/risansi/:path*',
    '/admin/:path*',
    // Print views render the same client and visit data as the portal pages and
    // were never matched, so they answered a revoked session in full.
    '/print/:path*',
    // The API was the real hole. Route handlers each authorise themselves, but
    // ~40 of them read the session through getServerSession rather than
    // getCurrentUser, so a status check added to that helper alone would have
    // missed them — and two lookup routes authenticate nothing at all.
    // Deliberately NOT matched: /api/auth/** (sign-in has to work for someone
    // holding no token) and /api/cron/** (guarded by CRON_SECRET, no session).
    '/api/risansi/:path*',
  ],
};
