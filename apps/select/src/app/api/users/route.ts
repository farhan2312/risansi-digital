import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { asc, eq, inArray } from "drizzle-orm";

import { error, json, userToDict } from "@/lib/api";
import { AuthError, requireSystemAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["user", "selection_head", "pulley_owner", "admin", "system_admin"]);

// System-admin only — managing the full user list (not just pending
// requests) is explicitly excluded from the plain "admin" role, per the
// 3-role spec.
export async function GET(req: Request) {
  try {
    await requireSystemAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const status = new URL(req.url).searchParams.get("status");
  const rows = status
    ? await db.select().from(users).where(eq(users.status, status)).orderBy(asc(users.createdAt))
    : await db.select().from(users).orderBy(asc(users.createdAt));

  // Who reviewed each account, by name. reviewed_by is set either when a
  // pending access request is approved/rejected, or when an admin adds the
  // user directly (then it is stamped at creation time, so the two moments
  // coincide - that is how "added" is told apart from "approved").
  const reviewerIds = [...new Set(rows.map((r) => r.reviewedBy).filter((v): v is string => !!v))];
  const reviewers = reviewerIds.length
    ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, reviewerIds))
    : [];
  const reviewerName = new Map(reviewers.map((r) => [r.id, r.name || r.email]));

  return json(
    rows.map((u) => {
      let reviewKind: "added" | "approved" | "rejected" | null = null;
      if (u.reviewedBy && u.reviewedAt) {
        const created = u.createdAt ? new Date(u.createdAt).getTime() : NaN;
        const reviewed = new Date(u.reviewedAt).getTime();
        reviewKind =
          Number.isFinite(created) && Math.abs(reviewed - created) < 5000
            ? "added"
            : u.status === "rejected"
              ? "rejected"
              : "approved";
      }
      return {
        ...userToDict(u),
        reviewed_by_name: u.reviewedBy ? reviewerName.get(u.reviewedBy) ?? "a removed user" : null,
        review_kind: reviewKind,
      };
    }),
  );
}

/**
 * Creating an account happens at Risansi Digital.
 *
 * Phase 4b. This made a row here with a local password, which no longer signs
 * anybody in — and it could not create the grant that decides whether they
 * may open this portal at all, because that lives in identity. An account
 * made here would have been a row nobody could use.
 *
 * The GET above stays: other screens need the list of people to assign work
 * to, and reading it was never the problem.
 */
export async function POST() {
  const HUB = (process.env.HUB_URL || "https://digital.risansi.com").replace(/\/+$/, "");
  return NextResponse.json(
    {
      error: "Create the account at Risansi Digital — it grants the portals at the same time.",
      manageUrl: `${HUB}/requests/people`,
    },
    { status: 410 },
  );
}

