import { json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Takes the request now (it didn't before) so the sign-out can be attributed
// to the user in the audit trail — the cookie is still on the request here.
export async function POST(req: Request) {
  await logAudit(req, {
    eventType: "logout",
    action: "auth.logout",
    detail: "Signed out",
  });

  const response = json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
