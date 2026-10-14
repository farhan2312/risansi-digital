"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { setRepName } from "@/lib/reps";
import { listOrderListOptions } from "@/lib/orders";
import { logAudit } from "@/lib/audit";

export type RepActionResult = { ok: true } | { ok: false; error: string };

/**
 * Which rep on the orders a Rep account is. Admin only. The name must be one
 * the orders actually carry (or empty to unlink), so a typo cannot quietly
 * leave somebody seeing nothing.
 */
export async function setRepNameAction(userId: string, repName: string): Promise<RepActionResult> {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "admin") return { ok: false, error: "Not authorized." };

  const name = String(repName ?? "").trim();
  if (name) {
    const { reps } = await listOrderListOptions();
    if (!reps.some((r) => r.trim().toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: "That rep is not on any order." };
    }
  }

  const done = await setRepName(String(userId), name);
  if (!done) return { ok: false, error: "That account is not a Rep." };
  if ((done.prev ?? "") !== name) {
    await logAudit({
      actor: { id: admin.id, email: admin.email, role: admin.role },
      action: "user.update",
      category: "ownership",
      target: done.email,
      details: `Rep link for ${done.email}: ${done.prev || "—"} → ${name || "—"}`,
    });
  }
  revalidatePath("/risansi/reps");
  return { ok: true };
}
