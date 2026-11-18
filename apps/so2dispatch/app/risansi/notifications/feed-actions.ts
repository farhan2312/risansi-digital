"use server";

import { getCurrentUser } from "@/lib/session";
import { markNotificationsSeen } from "@/lib/users";
import { revalidatePath } from "next/cache";
import { canSeeEscalations } from "@/lib/roles";
import { markAlertsSeen, unmarkAlertSeen } from "@/lib/alerts";

/** Called when the user opens the Notifications page, to clear the unread badge. */
export async function markNotificationsSeenAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await markNotificationsSeen(user.id);
}

/** The escalations opened (by key), or with none given every one active now: they fold away. */
export async function markEscalationsSeenAction(keys: string[] | null): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !canSeeEscalations(user.role)) return;
  await markAlertsSeen(user.id, keys ? keys.filter((k) => typeof k === "string").slice(0, 500) : null);
  // The sidebar badge counts the ones not opened.
  revalidatePath("/risansi", "layout");
}

/** An escalation ticked opened by mistake: back among the ones to see. */
export async function unmarkEscalationSeenAction(key: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !canSeeEscalations(user.role) || typeof key !== "string") return;
  await unmarkAlertSeen(user.id, key);
  revalidatePath("/risansi", "layout");
}
