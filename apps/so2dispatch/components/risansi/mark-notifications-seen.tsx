"use client";

import { useEffect } from "react";
import { markNotificationsSeenAction } from "@/app/risansi/notifications/feed-actions";

/**
 * Fire-and-forget: marks the user's notifications seen when the Notifications
 * page mounts, so the sidebar badge clears on the next navigation.
 */
export function MarkNotificationsSeen() {
  useEffect(() => {
    markNotificationsSeenAction();
  }, []);
  return null;
}
