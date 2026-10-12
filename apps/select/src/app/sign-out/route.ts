/**
 * POST /sign-out - clears the Risansi Digital session and sends you to the hub.
 *
 * The same shape as the sales portal's sign-out (apps/sales/app/sign-out):
 * a plain HTML form POST answered with a 303, an Origin check, and the shared
 * cookie cleared with the scope the hub set it with.
 *
 * Why it exists: since Phase 4b the only session this portal accepts is the
 * hub's `risansi_session`, scoped to `.risansi.com`. The old Sign out cleared
 * this app's own `auth_token` (no longer issued) and left that cookie alone,
 * so the middleware found it on the very next request and signed the person
 * straight back in - Sign out appeared to do nothing.
 *
 * Not a GET: a URL that signs you out can be fired by anything that can make
 * the browser issue a request (an <img> in an email included), and the cookie
 * covers every portal at once.
 */

import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, clearedCookieOptions } from "@risansi/identity";

import { logAudit } from "@/lib/audit";

const HUB = (process.env.HUB_URL || "https://digital.risansi.com").replace(/\/+$/, "");

/**
 * The scope the hub set the shared cookie with. A Set-Cookie that differs in
 * domain writes a second cookie instead of replacing the first, which would
 * leave the person signed in. RISANSI_COOKIE_DOMAIN when set; otherwise the
 * parent of the request's own host (select.risansi.com -> .risansi.com).
 * Undefined on *.vercel.app previews (a public suffix browsers refuse) and on
 * localhost / IP addresses, where the cookie is host-only anyway.
 */
function sharedCookieDomain(host: string | null): string | undefined {
  const explicit = process.env.RISANSI_COOKIE_DOMAIN;
  if (explicit) return explicit;

  const name = (host ?? "").split(":")[0]!.toLowerCase();
  if (!name || name.endsWith(".vercel.app")) return undefined;

  const labels = name.split(".");
  if (labels.length < 3 || /^[\d.]+$/.test(name)) return undefined;
  return `.${labels.slice(1).join(".")}`;
}

export async function POST(req: NextRequest) {
  const host = req.headers.get("host");

  // Same-origin only: this app's Sign out form always sends an Origin.
  const origin = req.headers.get("origin");
  let sameOrigin = false;
  try {
    sameOrigin = !!origin && new URL(origin).host === host;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) {
    return NextResponse.json({ error: "Sign out must be posted from the portal." }, { status: 403 });
  }

  // Logged before the cookie goes, while the request still says who it is.
  await logAudit(req, { eventType: "logout", action: "auth.logout", detail: "Signed out" });

  // 303, so the browser follows with a GET (a 307 would repeat the POST).
  const res = NextResponse.redirect(`${HUB}/sign-in`, 303);
  const domain = sharedCookieDomain(host);
  res.cookies.set(COOKIE_NAME, "", { ...clearedCookieOptions(), ...(domain ? { domain } : {}) });
  return res;
}
