import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { getDashboardList } from "@/lib/dashboard-list";

export const dynamic = "force-dynamic";

// The list behind a Dashboard KPI card, for any signed-in user.
//   kind      enquiries | tags
//   status    all | Pending | In Progress | Completed   (tags also: awaiting)
//   q         words searched in code / client / tag / media / model / creator
//   offset, limit (max 50)
//   from / to, mine=1 : same meaning as GET /api/dashboard

const KINDS = new Set(["enquiries", "tags"]);
const STATUSES = new Set(["all", "Pending", "In Progress", "Completed", "awaiting"]);

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

  const p = new URL(req.url).searchParams;
  const kind = p.get("kind") ?? "";
  const status = p.get("status") ?? "all";
  if (!KINDS.has(kind)) return error("'kind' must be enquiries or tags", 400);
  if (!STATUSES.has(status) || (status === "awaiting" && kind !== "tags")) return error("invalid 'status'", 400);

  return json(
    await getDashboardList({
      kind: kind as "enquiries" | "tags",
      status: status as "all" | "Pending" | "In Progress" | "Completed" | "awaiting",
      q: p.get("q") ?? "",
      offset: parseInt(p.get("offset") ?? "0", 10) || 0,
      limit: parseInt(p.get("limit") ?? "20", 10) || 20,
      since: parseInstant(p.get("from")),
      until: parseInstant(p.get("to")),
      mineUserId: p.get("mine") === "1" ? claims.sub : null,
    }),
  );
}
