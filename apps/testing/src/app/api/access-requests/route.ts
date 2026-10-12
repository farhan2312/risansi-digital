import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { error, json, userToDict } from "@/lib/api";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Admin and central-admin are assigned by an existing admin, not
// self-requested -- only the two day-to-day operational roles are offered
// on the public Request Access form.
const REQUESTABLE_ROLES = ["source", "testing"];

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = String(body.role ?? "");
  if (!name || !email || !password) {
    return error("'name', 'email', and 'password' are required", 400);
  }
  if (!REQUESTABLE_ROLES.includes(role)) {
    return error(`'role' must be one of: ${REQUESTABLE_ROLES.join(", ")}`, 400);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!existing) {
    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash, role, status: "pending" })
      .returning();
    return json(userToDict(user), 201);
  }

  if (existing.status === "pending") {
    return error("An access request for this email is already pending.", 409);
  }
  if (existing.status === "active") {
    return error("An account already exists for this email. Please log in.", 409);
  }

  // Only a REJECTED request may be resubmitted. Anything else (deactivated
  // accounts especially) belongs to a real, existing user whose password and
  // role must never be overwritten by an unauthenticated request -- an admin
  // reactivates those from Users & Access.
  if (existing.status !== "rejected") {
    return error("An account already exists for this email. Please contact an administrator.", 409);
  }

  // status == "rejected" — allow resubmission
  const [updated] = await db
    .update(users)
    .set({
      name,
      passwordHash,
      role,
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
    })
    .where(eq(users.id, existing.id))
    .returning();
  return json(userToDict(updated));
}
