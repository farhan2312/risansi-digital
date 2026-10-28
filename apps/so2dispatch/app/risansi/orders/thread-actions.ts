"use server";

import { getCurrentUser } from "@/lib/session";
import { getOrderRep } from "@/lib/orders";
import { repMatches } from "@/lib/dept-view";
import { isRep, roleLabel } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { subjectForOrder } from "@/lib/audit-subject";

import {
  canLogDelay,
  canUsePeer,
  deleteMessage,
  editMessage,
  insertMessage,
  isMessageKind,
  listConversations,
  listDelayLogs,
  listDiscussionInbox,
  listAllChats,
  listMessages,
  markConversationRead,
  sidesFor,
  MAX_MESSAGE_LENGTH,
  type ChatPage,
  type ConversationSummary,
  type DelayLogReport,
  type InboxEntry,
  type OrderMessage,
} from "@/lib/order-messages";
import { isAssignedTo } from "@/lib/so-assignment";

/**
 * A Rep talks only on their own SOs, a Rep Manager on their team's too: every
 * Rep and Rep Manager shares the one "rep" lane, so the SO itself must be
 * theirs. Anyone else is not limited here.
 */
async function repOwns(user: { id?: string; role: string; rep_names?: string[] }, orderId: string): Promise<boolean> {
  // An Order Making SO member: only the SOs assigned to them.
  if (user.role === "order_making_so") return !!user.id && (await isAssignedTo(orderId, user.id));
  if (!isRep(user.role)) return true;
  return repMatches(await getOrderRep(orderId), user.rep_names);
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
      // A public endpoint: the delay flag is checked here too.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where an entry sat, as the audit log says it: "Planning → Central Visibility". */
const laneOf = (m: { dept_role: string; to_role: string | null }) =>
  `${roleLabel(m.dept_role)} → ${roleLabel(m.to_role ?? "central_visibility")}`;

/**
 * Change one of your own entries (a note or a delay) in this conversation.
 * The old text goes to the audit log; the entry then says it was edited.
 */
export async function editMessageAction(orderId: string, peer: string, messageId: string, body: string): Promise<ThreadResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!UUID_RE.test(messageId) || !canUsePeer(user.role, peer)) return { ok: false, error: "That message is not here." };
  if (!(await repOwns(user, orderId))) return { ok: false, error: "You don't have access to that conversation." };
  const text = body.trim();
  if (text === "") return { ok: false, error: "A message can't be empty — delete it instead." };
  if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` };
  try {
    const was = await editMessage(messageId, user.id, text);
    if (!was || was.order_id !== orderId) return { ok: false, error: "Only its author can edit a message." };
    if (was.body !== text) {
      await logAudit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: "message.edit",
        category: "activity",
        target: `${was.kind === "delay" ? "Delay" : "Note"} · ${laneOf(was)}`,
        details: `Was: ${was.body.slice(0, 500)}\nNow: ${text.slice(0, 500)}`,
        subject: await subjectForOrder(orderId),
      });
    }
    return { ok: true, messages: await listMessages(orderId, peer, user) };
  } catch (error) {
    console.error("editMessageAction failed:", error);
    return { ok: false, error: "Could not save that change." };
  }
}

/**
 * Delete an entry (a note or a delay): your own, or — Admin — anyone's. A
 * delay goes off the delay log with it. Its text is kept in the audit log.
 */
export async function deleteMessageAction(orderId: string, peer: string, messageId: string): Promise<ThreadResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!UUID_RE.test(messageId) || !canUsePeer(user.role, peer)) return { ok: false, error: "That message is not here." };
  if (!(await repOwns(user, orderId))) return { ok: false, error: "You don't have access to that conversation." };
  try {
    const gone = await deleteMessage(messageId, user.id, (user.primary_role ?? user.role) === "admin");
    if (!gone) return { ok: false, error: "Only its author can delete a message." };
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "message.delete",
      category: "activity",
      target: `${gone.kind === "delay" ? "Delay" : "Note"} · ${laneOf(gone)}`,
      details: `Deleted: ${gone.body.slice(0, 1000)}`,
      subject: await subjectForOrder(gone.order_id),
    });
    return { ok: true, messages: await listMessages(orderId, peer, user) };
  } catch (error) {
    console.error("deleteMessageAction failed:", error);
    return { ok: false, error: "Could not delete that message." };
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
    if (!isRep(user.role) && user.role !== "order_making_so") return { ok: true, entries };
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

export type AllChatsResult =
  | ({ ok: true; role: string } & ChatPage)
  | { ok: false; error: string };

/**
 * One page of every SO conversation the user is in, latest first — the All
 * chats list. `peerHits`: the departments whose name the search matched.
 */
export async function allChatsAction(
  opts: { offset?: number; search?: string; peerHits?: string[]; unreadOnly?: boolean } = {}
): Promise<AllChatsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  try {
    const page = await listAllChats(user, {
      offset: opts.offset,
      search: String(opts.search ?? "").slice(0, 100),
      peerHits: (opts.peerHits ?? []).filter((p) => typeof p === "string").slice(0, 30),
      unreadOnly: !!opts.unreadOnly,
      // A Rep: their own SOs only; an Order Making SO member: the SOs assigned to them.
      repNames: isRep(user.role) ? (user.rep_names ?? []) : undefined,
      assigneeId: user.role === "order_making_so" ? user.id : undefined,
    });
    return { ok: true, role: user.role, ...page };
  } catch (error) {
    console.error("allChatsAction failed:", error);
    return { ok: false, error: "Could not load the chats." };
  }
}
