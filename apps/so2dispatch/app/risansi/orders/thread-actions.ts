"use server";

import { getCurrentUser } from "@/lib/session";
import { getOrderRep } from "@/lib/orders";
import { repMatches } from "@/lib/dept-view";

import {
  canLogDelay,
  canUsePeer,
  insertMessage,
  isMessageKind,
  listConversations,
  listDelayLogs,
  listDiscussionInbox,
  listMessages,
  markConversationRead,
  sidesFor,
  MAX_MESSAGE_LENGTH,
  type ConversationSummary,
  type DelayLogReport,
  type InboxEntry,
  type OrderMessage,
} from "@/lib/order-messages";
import { isAssignedTo } from "@/lib/so-assignment";

/**
 * A Rep talks only on their own SOs: every Rep shares the one "rep" lane, so
 * the SO itself must be theirs. Anyone else is not limited here.
 */
async function repOwns(user: { id?: string; role: string; rep_name?: string | null }, orderId: string): Promise<boolean> {
  // An Order Making SO member: only the SOs assigned to them.
  if (user.role === "order_making_so") return !!user.id && (await isAssignedTo(orderId, user.id));
  if (user.role !== "rep") return true;
  return repMatches(await getOrderRep(orderId), user.rep_name);
}

export type ThreadResult =
  | { ok: true; messages: OrderMessage[] }
  | { ok: false; error: string };

export type ConversationsResult =
  | { ok: true; conversations: ConversationSummary[] }
  | { ok: false; error: string };

/**
 * Read one conversation on an SO and mark it read. The peer is authorized
 * against the caller's role, so a department can only ever open a conversation
 * it is part of, no matter what the browser asks for.
 */
export async function openThreadAction(
  orderId: string,
  peer: string
): Promise<ThreadResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canUsePeer(user.role, peer) || !(await repOwns(user, orderId))) {
    return { ok: false, error: "You don't have access to that conversation." };
  }

  try {
    const messages = await listMessages(orderId, peer, user);
    await markConversationRead(user.id, orderId, peer);
    return { ok: true, messages };
  } catch (error) {
    console.error("openThreadAction failed:", error);
    return { ok: false, error: "Could not load the conversation." };
  }
}

/** Every conversation the caller may hold on one SO, with its unread count. */
export async function listConversationsAction(
  orderId: string
): Promise<ConversationsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!(await repOwns(user, orderId))) return { ok: false, error: "You don't have access to that conversation." };
  try {
    return { ok: true, conversations: await listConversations(orderId, user) };
  } catch (error) {
    console.error("listConversationsAction failed:", error);
    return { ok: false, error: "Could not load the conversation." };
  }
}

/**
 * Post into one conversation. The peer names the other side: a department for
 * Central, and for a department either another department or Central
 * Visibility. Which columns that lands in is sidesFor's business.
 */
export async function postMessageAction(
  orderId: string,
  peer: string,
  body: string,
  kind = "note"
): Promise<ThreadResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };

  const sides = sidesFor(user.role, peer);
  if (!sides) return { ok: false, error: "Pick who to send this to." };
  if (!(await repOwns(user, orderId))) return { ok: false, error: "You don't have access to that conversation." };

  const text = body.trim();
  if (text === "") return { ok: false, error: "Type a message first." };
  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }

  try {
    await insertMessage({
      orderId,
      deptRole: sides.deptRole,
      toRole: sides.toRole,
      authorId: user.id,
      authorName: user.full_name,
      authorRole: user.role,
      body: text,
      // The UI hides the delay toggle outside the conversation with Central,
      // but this is a public endpoint, so the rule is enforced here too.
      kind:
        isMessageKind(kind) && canLogDelay(user.role, peer) ? kind : "note",
    });
    await markConversationRead(user.id, orderId, peer);

    const messages = await listMessages(orderId, peer, user);
    return { ok: true, messages };
  } catch (error) {
    console.error("postMessageAction failed:", error);
    return { ok: false, error: "Could not send that message." };
  }
}

export type InboxResult =
  | { ok: true; entries: InboxEntry[] }
  | { ok: false; error: string };

/** Unread discussion entries for the header icon. */
export async function discussionInboxAction(): Promise<InboxResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  try {
    const entries = await listDiscussionInbox(user);
    if (user.role !== "rep" && user.role !== "order_making_so") return { ok: true, entries };
    // A Rep: only the discussions on their own SOs.
    const owned = await Promise.all(entries.map((e) => repOwns(user, e.order_id)));
    return { ok: true, entries: entries.filter((_, i) => owned[i]) };
  } catch (error) {
    console.error("discussionInboxAction failed:", error);
    return { ok: false, error: "Could not load discussions." };
  }
}

export type DelayLogsResult =
  | { ok: true; report: DelayLogReport }
  | { ok: false; error: string };

/** The delay log of one SO, for the modal and the PDF. */
export async function delayLogsAction(
  orderId: string
): Promise<DelayLogsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!(await repOwns(user, orderId))) return { ok: false, error: "You don't have access to that SO." };
  try {
    return { ok: true, report: await listDelayLogs(orderId, user) };
  } catch (error) {
    console.error("delayLogsAction failed:", error);
    return { ok: false, error: "Could not load the delay log." };
  }
}
