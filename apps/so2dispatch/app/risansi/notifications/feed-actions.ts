"use server";

import { getCurrentUser } from "@/lib/session";
import { markNotificationsSeen } from "@/lib/users";

/** Called when the user opens the Notifications page, to clear the unread badge. */
export async function markNotificationsSeenAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await markNotificationsSeen(user.id);
}
