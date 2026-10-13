"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { isCentral } from "@/lib/roles";
import { getSetting, setSetting, USD_INR_RATE } from "@/lib/settings";
import { logAudit } from "@/lib/audit";

export type SaveRateResult = { ok: true } | { ok: false; error: string };

/**
 * Set the USD → INR rate. Central Visibility and Admin only. New USD orders,
 * and USD orders not yet converted, use it from their next save; an order
 * already converted keeps the rate it was converted at.
 */
export async function saveUsdInrRateAction(raw: string): Promise<SaveRateResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!isCentral(user.role)) {
    return { ok: false, error: "Only Central Visibility or Admin can set the rate." };
  }
  const n = Number(String(raw).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "Enter a rate above zero, e.g. 88.25." };
  if (n > 1000) return { ok: false, error: "That rate looks too high for USD → INR." };
  const rate = String(Math.round(n * 10000) / 10000);
  try {
    const before = (await getSetting(USD_INR_RATE)).value;
    await setSetting(USD_INR_RATE, rate, user.id);
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "settings.update",
      category: "activity",
      target: "USD → INR rate",
      details: `USD → INR rate: ${before ?? "not set"} → ${rate}`,
    });
    revalidatePath("/risansi/settings");
    return { ok: true };
  } catch (error) {
    console.error("saveUsdInrRate failed:", error);
    return { ok: false, error: "Could not save the rate." };
  }
}
