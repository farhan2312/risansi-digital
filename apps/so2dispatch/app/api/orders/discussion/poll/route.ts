import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getOrderRep } from "@/lib/orders";
import { repMatches } from "@/lib/dept-view";
import {
  canUsePeer,
  countDiscussionUnread,
  latestActivity,
  listConversations,
  listMessages,
  markConversationRead,
} from "@/lib/order-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hold the request open this long before answering "nothing new". Kept under
// the ~30s idle timeout most proxies enforce, so the connection is closed by
// us rather than dropped mid-flight.
const HOLD_MS = 25_000;
// How often to re-check while holding. This is the worst-case delivery delay,
// so it's the knob that trades latency against database load.
const CHECK_MS = 2_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Long-poll the SO discussion. Two modes:
 *
 *  - with `order`: watches every conversation on that SO. The token is the
 *    newest message the caller can see, so a message landing in a tab they are
 *    not looking at still wakes the poll and refreshes its badge.
 *  - without: watches the caller's unread total, for the header icon.
 *
 * Returns as soon as the token moves, otherwise resolves unchanged after
 * HOLD_MS and the client asks again.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const params = req.nextUrl.searchParams;
  const orderId = params.get("order");
  const peer = params.get("peer");
  const since = params.get("since");

  // The peer is authorized here too: this is a public endpoint, whatever the
  // UI happens to be showing.
  if (orderId && peer && !canUsePeer(user.role, peer)) {
    return new Response("Forbidden", { status: 403 });
  }
  // A Rep watches only their own SOs.
  if (orderId && user.role === "rep" && !repMatches(await getOrderRep(orderId), user.rep_name)) {
    return new Response("Forbidden", { status: 403 });
  }

  const token = () =>
    orderId
      ? latestActivity(orderId, user)
      : countDiscussionUnread(user).then(String);

  const deadline = Date.now() + HOLD_MS;
  let now = await token();

  while (String(now ?? "") === String(since ?? "")) {
    // Client navigated away or aborted — stop holding the connection.
    if (req.signal.aborted || Date.now() >= deadline) break;
    await sleep(CHECK_MS);
    now = await token();
  }

  const changed = String(now ?? "") !== String(since ?? "");

  if (!orderId) {
    return Response.json({ since: now, changed, unread: Number(now ?? 0) });
  }

  // Whole conversation rather than a cursor: they are short, and replacing
  // wholesale cannot drift out of order or double up the way a merge can.
  const [messages, conversations, unread] = await Promise.all([
    peer && changed ? listMessages(orderId, peer, user) : Promise.resolve(null),
    changed ? listConversations(orderId, user) : Promise.resolve(null),
    countDiscussionUnread(user),
  ]);

  // Anything delivered into the conversation on screen has been seen.
  if (changed && peer) await markConversationRead(user.id, orderId, peer);

  return Response.json({ since: now, changed, messages, conversations, unread });
}
