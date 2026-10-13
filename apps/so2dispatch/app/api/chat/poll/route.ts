import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import {
  countUnreadMessages,
  getContact,
  listThread,
  markThreadRead,
} from "@/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hold the request open this long before answering "nothing new". Kept under
// the ~30s idle timeout most proxies enforce, so the connection is closed by
// us rather than dropped mid-flight.
const HOLD_MS = 25_000;
// How often to re-check the table while holding. This is the worst-case
// delivery delay, so it's the knob that trades latency against DB load.
const CHECK_MS = 1_500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Long-poll for new messages in one thread. Returns as soon as something
 * arrives, otherwise resolves empty after HOLD_MS and the client re-asks.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const otherId = req.nextUrl.searchParams.get("with") ?? "";
  const after = req.nextUrl.searchParams.get("after") ?? undefined;

  // Re-check the pairing rule here too: this is a public endpoint.
  const contact = await getContact(user.role, otherId);
  if (!contact) return new Response("Forbidden", { status: 403 });

  const deadline = Date.now() + HOLD_MS;
  while (true) {
    const messages = await listThread(user.id, otherId, after);
    if (messages.length > 0) {
      // The user is looking at this thread, so anything they just received
      // counts as read.
      await markThreadRead(user.id, otherId);
      return Response.json({
        messages,
        unread: await countUnreadMessages(user.id),
      });
    }
    // Client navigated away or aborted — stop holding the connection.
    if (req.signal.aborted || Date.now() >= deadline) break;
    await sleep(CHECK_MS);
  }

  return Response.json({
    messages: [],
    unread: await countUnreadMessages(user.id),
  });
}
