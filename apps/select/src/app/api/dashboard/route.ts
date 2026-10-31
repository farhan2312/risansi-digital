import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { seesAllEnquiries } from "@/lib/roles";
import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

// Dashboard figures for any signed-in user.
//   from / to : ISO instants bounding created_at; either may be absent
//   mine=1    : only enquiries assigned to the caller (always so for a worker)

const parseInstant = (v: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const params = new URL(req.url).searchParams;
  return json(
    await getDashboardData({
      since: parseInstant(params.get("from")),
      until: parseInstant(params.get("to")),
      // A worker only ever sees the enquiries assigned to them.
      mineUserId: params.get("mine") === "1" || !seesAllEnquiries(claims.role) ? claims.sub : null,
    }),
  );
}
