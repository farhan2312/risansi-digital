import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

// Dashboard figures for any signed-in user.
//   from / to : ISO instants bounding created_at; either may be absent
//   mine=1    : only enquiries the caller created

const parseInstant = (v: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function GET(req: Request) {
  let claims;
  try {
    claims = decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const params = new URL(req.url).searchParams;
  return json(
    await getDashboardData({
      since: parseInstant(params.get("from")),
      until: parseInstant(params.get("to")),
      mineUserId: params.get("mine") === "1" ? claims.sub : null,
    }),
  );
}
