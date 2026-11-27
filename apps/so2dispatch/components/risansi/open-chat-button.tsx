"use client";

import { ArrowRight } from "lucide-react";

/** The event the app shell listens for to open Discussion on one SO's chat. */
export const OPEN_CHAT_EVENT = "risansi:open-chat";
export type OpenChatDetail = { orderId: string; soLabel: string };

/** Open Discussion at an SO's chat, over whatever page this is (a tag's notification). */
export function OpenChatButton({ orderId, soLabel, className }: { orderId: string; soLabel: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent<OpenChatDetail>(OPEN_CHAT_EVENT, { detail: { orderId, soLabel } }))}
      className={className}
    >
      Open chat
      <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}
