"use server";

import { getCurrentUser } from "@/lib/session";
import {
  canMessage,
  getContact,
  listContacts,
  listConversations,
  listThread,
  markThreadRead,
  sendMessage,
  type ChatContact,
  type ChatConversation,
  type ChatMessage,
} from "@/lib/chat";

export type SendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: string };

export async function searchContactsAction(
  search: string
): Promise<ChatContact[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  return listContacts(user.id, user.role, search);
}

export async function listConversationsAction(): Promise<ChatConversation[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  return listConversations(user.id, user.role);
}

export async function openThreadAction(
  otherId: string
): Promise<{ contact: ChatContact; messages: ChatMessage[] } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const contact = await getContact(user.role, otherId);
  if (!contact) return null;
  const messages = await listThread(user.id, otherId);
  await markThreadRead(user.id, otherId);
  return { contact, messages };
}

export async function sendMessageAction(
  otherId: string,
  body: string
): Promise<SendResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };

  const contact = await getContact(user.role, otherId);
  if (!contact || !canMessage(user.role, contact.role)) {
    return { ok: false, error: "You can't message this user." };
  }
  if (body.trim() === "") return { ok: false, error: "Message is empty." };

  try {
    const message = await sendMessage(user.id, otherId, body);
    if (!message) return { ok: false, error: "Could not send the message." };
    return { ok: true, message };
  } catch (error) {
    console.error("sendMessage failed:", error);
    return { ok: false, error: "Could not send the message. Please try again." };
  }
}

export async function markThreadReadAction(otherId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await markThreadRead(user.id, otherId);
}
