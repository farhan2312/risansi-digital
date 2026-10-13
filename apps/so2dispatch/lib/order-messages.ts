import { query } from "@/lib/db";
import { ALL_ROLES, isCentral, type Role } from "@/lib/roles";

/**
 * Per-SO discussion, as two-party conversations.
 *
 * A message names its author's side (`dept_role`) and, optionally, the
 * department it was sent to (`to_role`). A message with no recipient is
 * addressed to Central Visibility — which is the shape every message had
 * before departments could talk to each other, so nothing stored needs
 * rewriting.
 *
 * The two parties are therefore `dept_role` and `to_role ?? central`, and a
 * conversation is strictly between them. Everyone — Central included — sees
 * only the conversations they are in: a department talks to Central and to
 * each other department, Central talks to each department. Two departments
 * talking to each other is theirs alone.
 *
 * Messages are append-only — nothing here updates or deletes them.
 */

export type OrderMessage = {
  id: string;
  dept_role: string;
  /** Who it was sent to, or null for Central Visibility. */
  to_role: string | null;
  author_id: string | null;
  author_name: string;
  author_role: string;
  kind: string;
  body: string;
  created_at: string;
  mine: boolean;
};

/** A discussion entry is a plain note or a flagged delay. */
export type MessageKind = "note" | "delay";

export function isMessageKind(value: string): value is MessageKind {
  return value === "note" || value === "delay";
}

/** One conversation on an SO — who it is with, and its activity. */
export type ConversationSummary = {
  /** The other side: a department role, or 'central_visibility'. */
  peer: string;
  total: number;
  unread: number;
  last_at: string | null;
  last_body: string | null;
};

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

// Every column the UI renders for a message, aliased consistently so the
// read and the insert-returning share one shape.
const MESSAGE_COLUMNS = `m.id, m.dept_role, m.to_role, m.author_id,
            m.author_name, m.author_role, m.kind, m.body,
            to_char(m.created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at`;

export const MAX_MESSAGE_LENGTH = 2000;

/** The department roles a conversation can be with — every non-central role. */
export const DEPARTMENT_LANES: Role[] = ALL_ROLES.filter((r) => !isCentral(r));

/** Central Visibility as a conversation partner. Admin shares this side. */
export const CENTRAL_PEER = "central_visibility";

function isDepartmentLane(value: string): value is Role {
  return (DEPARTMENT_LANES as string[]).includes(value);
}

function isPeer(value: string): boolean {
  return value === CENTRAL_PEER || isDepartmentLane(value);
}

/**
 * Who this user can hold a conversation with on an SO.
 *
 * A department talks to every other department and to Central; Central talks
 * to each department — one conversation per department, as before.
 */
export function peersFor(role: string): string[] {
  if (isCentral(role)) return [...DEPARTMENT_LANES];
  if (!isDepartmentLane(role)) return [];
  return [...DEPARTMENT_LANES.filter((r) => r !== role), CENTRAL_PEER];
}

/**
 * Whether a delay may be logged in this conversation. A delay goes on the
 * order's record, which is Central's to keep — department-to-department is
 * ordinary chatter, so it only carries notes.
 */
export function canLogDelay(role: string, peer: string): boolean {
  return isCentral(role) ? isDepartmentLane(peer) : peer === CENTRAL_PEER;
}

/** Whether this user may open and post in the conversation with `peer`. */
export function canUsePeer(role: string, peer: string): boolean {
  return peersFor(role).includes(peer);
}

/**
 * Which messages belong to the viewer's conversation with `peer`. Both sides
 * are pinned, so nothing from a third party leaks in.
 *
 * Central is one side of every conversation it can open, and a message with no
 * recipient is exactly the one addressed to Central — so their filter is the
 * department plus that.
 *
 * `peerParam` and `roleParam` are the parameter placeholders to substitute.
 */
function conversationSql(viewerRole: string, peerParam: string, roleParam: string) {
  if (isCentral(viewerRole)) {
    return `(m.dept_role = ${peerParam} AND m.to_role IS NULL)`;
  }
  return `(m.dept_role = ${peerParam}
           OR COALESCE(m.to_role, '${CENTRAL_PEER}') = ${peerParam})
          AND (m.dept_role = ${roleParam}
               OR COALESCE(m.to_role, '${CENTRAL_PEER}') = ${roleParam})`;
}

/** Every message this user may see at all, whatever conversation it is in. */
function visibleSql(viewerRole: string, roleParam: string) {
  // Central is a party to exactly the messages that name no other recipient.
  if (isCentral(viewerRole)) return "m.to_role IS NULL";
  return `(m.dept_role = ${roleParam}
           OR COALESCE(m.to_role, '${CENTRAL_PEER}') = ${roleParam})`;
}

/**
 * Which conversation a message counts towards for this viewer — the key its
 * read marker is stored under. Central files everything under the author's
 * department, so their unread never double-counts a department-to-department
 * message that involves two of their conversations.
 */
function peerOfSql(viewerRole: string, roleParam: string) {
  if (isCentral(viewerRole)) return "m.dept_role";
  return `CASE WHEN m.to_role IS NULL THEN '${CENTRAL_PEER}'
               WHEN m.dept_role = ${roleParam} THEN m.to_role
               ELSE m.dept_role END`;
}

/**
 * Append the viewer's role to a query's parameters, but only when the SQL will
 * reference it: every predicate above collapses to a constant for Central, and
 * Postgres rejects a parameter the statement never binds.
 */
function withRole(
  viewer: { role: string },
  params: unknown[]
): { param: string; params: unknown[] } {
  if (isCentral(viewer.role)) return { param: "", params };
  return { param: `$${params.length + 1}`, params: [...params, viewer.role] };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One conversation on one SO, oldest first. */
export async function listMessages(
  orderId: string,
  peer: string,
  viewer: { id: string; role: string }
): Promise<OrderMessage[]> {
  if (!canUsePeer(viewer.role, peer)) return [];
  const { param, params } = withRole(viewer, [orderId, peer, viewer.id]);
  const result = await query<OrderMessage>(
    `SELECT ${MESSAGE_COLUMNS},
            (m.author_id = $3) AS mine
       FROM order_messages m
      WHERE m.order_id = $1
        AND ${conversationSql(viewer.role, "$2", param)}
      ORDER BY m.created_at ASC`,
    params
  );
  return result.rows;
}

/**
 * Every conversation the viewer may hold on one SO, including the empty ones,
 * so a department can start one with a department that has not posted yet.
 */
export async function listConversations(
  orderId: string,
  viewer: { id: string; role: string }
): Promise<ConversationSummary[]> {
  // A Spare SO is none of Drawing's, Purchase's or Quality's work, so there
  // is no conversation to hold with them about it.
  const spare = await query<{ spare: boolean }>(
    `SELECT lower(btrim(COALESCE(order_type, ''))) = 'spare' AS spare FROM orders WHERE id = $1`,
    [orderId]
  );
  const peers = peersFor(viewer.role).filter(
    (p) => !(spare.rows[0]?.spare && (p === "drawing" || p === "purchase" || p === "qc"))
  );
  if (peers.length === 0) return [];

  const { param, params } = withRole(viewer, [orderId, viewer.id]);
  const result = await query<{
    peer: string;
    total: string;
    unread: string;
    last_at: string | null;
    last_body: string | null;
  }>(
    `SELECT ${peerOfSql(viewer.role, param)} AS peer,
            COUNT(*)::text AS total,
            COUNT(*) FILTER (
              WHERE m.author_id <> $2
                AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
            )::text AS unread,
            to_char(MAX(m.created_at) AT TIME ZONE 'UTC', ${ISO}) AS last_at,
            (ARRAY_AGG(m.body ORDER BY m.created_at DESC))[1] AS last_body
       FROM order_messages m
       LEFT JOIN order_message_reads r
              ON r.user_id = $2
             AND r.order_id = m.order_id
             AND r.dept_role = ${peerOfSql(viewer.role, param)}
      WHERE m.order_id = $1
        AND ${visibleSql(viewer.role, param)}
      GROUP BY 1`,
    params
  );

  const bySlug = new Map(result.rows.map((r) => [r.peer, r]));
  return peers.map((peer) => {
    const row = bySlug.get(peer);
    return {
      peer,
      total: row ? Number(row.total) : 0,
      unread: row ? Number(row.unread) : 0,
      last_at: row?.last_at ?? null,
      last_body: row?.last_body ?? null,
    };
  });
}

/**
 * Unread counts keyed by order id, for badging a list of SOs. Counts only what
 * the viewer can see, and never their own messages.
 */
export async function unreadByOrder(
  orderIds: string[],
  viewer: { id: string; role: string }
): Promise<Record<string, number>> {
  if (peersFor(viewer.role).length === 0 || orderIds.length === 0) return {};

  const { param, params } = withRole(viewer, [orderIds, viewer.id]);
  const result = await query<{ order_id: string; unread: string }>(
    `SELECT m.order_id, COUNT(*)::text AS unread
       FROM order_messages m
       LEFT JOIN order_message_reads r
              ON r.user_id = $2
             AND r.order_id = m.order_id
             AND r.dept_role = ${peerOfSql(viewer.role, param)}
      WHERE m.order_id = ANY($1)
        AND ${visibleSql(viewer.role, param)}
        AND m.author_id <> $2
        AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
      GROUP BY m.order_id`,
    params
  );

  const counts: Record<string, number> = {};
  for (const row of result.rows) counts[row.order_id] = Number(row.unread);
  return counts;
}

/**
 * The newest thing the viewer can see on one SO — a change token for the
 * long poll. Messages are append-only, so this only ever moves forward, and
 * comparing it is enough to know something arrived in any conversation on the
 * order, not just the one on screen.
 */
export async function latestActivity(
  orderId: string,
  viewer: { id: string; role: string }
): Promise<string | null> {
  if (peersFor(viewer.role).length === 0) return null;
  const { param, params } = withRole(viewer, [orderId]);
  const result = await query<{ at: string | null }>(
    `SELECT to_char(MAX(m.created_at) AT TIME ZONE 'UTC', ${ISO}) AS at
       FROM order_messages m
      WHERE m.order_id = $1 AND ${visibleSql(viewer.role, param)}`,
    params
  );
  return result.rows[0]?.at ?? null;
}

/** One unread discussion entry, for the header inbox. */
export type InboxEntry = {
  id: string;
  order_id: string;
  so_no: string | null;
  sl_no: number;
  dept_role: string;
  to_role: string | null;
  /** The conversation it belongs to from the viewer's side. */
  peer: string;
  author_name: string;
  author_role: string;
  kind: string;
  body: string;
  created_at: string;
};

/**
 * Unread discussion entries across every SO, newest first — what the header's
 * discussion icon shows. A user never sees their own messages here.
 */
export async function listDiscussionInbox(
  viewer: { id: string; role: string },
  limit = 20
): Promise<InboxEntry[]> {
  if (peersFor(viewer.role).length === 0) return [];
  const { param, params } = withRole(viewer, [viewer.id, limit]);
  const result = await query<InboxEntry>(
    `SELECT m.id, m.order_id, o.so_no, o.sl_no::int AS sl_no, m.dept_role,
            m.to_role, ${peerOfSql(viewer.role, param)} AS peer,
            m.author_name, m.author_role, m.kind, m.body,
            to_char(m.created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at
       FROM order_messages m
       JOIN orders o ON o.id = m.order_id
       LEFT JOIN order_message_reads r
              ON r.user_id = $1
             AND r.order_id = m.order_id
             AND r.dept_role = ${peerOfSql(viewer.role, param)}
      WHERE ${visibleSql(viewer.role, param)}
        AND m.author_id <> $1
        AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
      ORDER BY m.created_at DESC
      LIMIT $2`,
    params
  );
  return result.rows;
}

/** How many unread discussion entries the viewer has, in total. */
export async function countDiscussionUnread(viewer: {
  id: string;
  role: string;
}): Promise<number> {
  if (peersFor(viewer.role).length === 0) return 0;
  const { param, params } = withRole(viewer, [viewer.id]);
  const result = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM order_messages m
       LEFT JOIN order_message_reads r
              ON r.user_id = $1
             AND r.order_id = m.order_id
             AND r.dept_role = ${peerOfSql(viewer.role, param)}
      WHERE ${visibleSql(viewer.role, param)}
        AND m.author_id <> $1
        AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
        ${viewer.role === "order_making_so" ? "AND EXISTS (SELECT 1 FROM orders so WHERE so.id = m.order_id AND so.so_assignee_id = $1)" : ""}`,
    params
  );
  return Number(result.rows[0]?.n ?? 0);
}

/** One logged delay, for the delay-log table. */
export type DelayLog = {
  id: string;
  dept_role: string;
  author_name: string;
  author_role: string;
  body: string;
  created_at: string;
};

/** The delay log of one SO, with that SO's target dates for context. */
export type DelayLogReport = {
  so_no: string | null;
  sl_no: number;
  targets: Record<string, string | null>;
  logs: DelayLog[];
};

/**
 * Every delay logged against one SO, oldest first. A department sees the
 * delays in conversations it is part of; Central sees all of them.
 */
export async function listDelayLogs(
  orderId: string,
  viewer: { id: string; role: string }
): Promise<DelayLogReport> {
  const order = await query<{
    so_no: string | null;
    sl_no: number;
    drg_target_date: string | null;
    purchase_target_date: string | null;
    qc_doc_target_date: string | null;
    dispatch_team_target_date: string | null;
    dispatch_target_date: string | null;
    dispatch_target_revised_date: string | null;
  }>(
    `SELECT so_no, sl_no::int AS sl_no,
            to_char(drg_target_date, 'YYYY-MM-DD')           AS drg_target_date,
            to_char(purchase_target_date, 'YYYY-MM-DD')      AS purchase_target_date,
            to_char(qc_doc_target_date, 'YYYY-MM-DD')        AS qc_doc_target_date,
            to_char(dispatch_team_target_date, 'YYYY-MM-DD') AS dispatch_team_target_date,
            to_char(dispatch_target_date, 'YYYY-MM-DD')      AS dispatch_target_date,
            to_char(dispatch_target_revised_date, 'YYYY-MM-DD')
              AS dispatch_target_revised_date
       FROM orders WHERE id = $1`,
    [orderId]
  );
  const row = order.rows[0];
  const { so_no = null, sl_no = 0, ...targets } = row ?? {};

  if (peersFor(viewer.role).length === 0) {
    return { so_no, sl_no, targets, logs: [] };
  }

  const { param, params } = withRole(viewer, [orderId]);
  const result = await query<DelayLog>(
    `SELECT m.id, m.dept_role, m.author_name, m.author_role, m.body,
            to_char(m.created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at
       FROM order_messages m
      WHERE m.order_id = $1
        AND ${visibleSql(viewer.role, param)}
        AND m.kind = 'delay'
      ORDER BY m.created_at ASC`,
    params
  );

  return { so_no, sl_no, targets, logs: result.rows };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * The two sides a message is stored as.
 *
 * Central's messages keep the original shape — the department in `dept_role`,
 * no recipient — so their conversations read exactly as they always have. A
 * department writes its own role as the author side, and names the department
 * it is asking; addressing Central means no recipient, which is the same shape
 * again.
 */
export function sidesFor(
  role: string,
  peer: string
): { deptRole: string; toRole: string | null } | null {
  if (!canUsePeer(role, peer) || !isPeer(peer)) return null;
  if (isCentral(role)) return { deptRole: peer, toRole: null };
  return { deptRole: role, toRole: peer === CENTRAL_PEER ? null : peer };
}

export async function insertMessage(input: {
  orderId: string;
  deptRole: string;
  toRole: string | null;
  authorId: string;
  authorName: string;
  authorRole: string;
  body: string;
  // 'delay' flags the entry as a delay; the date it happened is its
  // created_at, so nothing else is stored.
  kind?: MessageKind;
}): Promise<OrderMessage> {
  const result = await query<OrderMessage>(
    `INSERT INTO order_messages
        (order_id, dept_role, to_role, author_id, author_name, author_role,
         body, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, dept_role, to_role, author_id, author_name, author_role,
               kind, body,
               to_char(created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at,
               true AS mine`,
    [
      input.orderId,
      input.deptRole,
      input.toRole,
      input.authorId,
      input.authorName,
      input.authorRole,
      input.body,
      input.kind ?? "note",
    ]
  );
  return result.rows[0];
}

/**
 * Mark one conversation read up to now.
 *
 * Read state is keyed by conversation, not by lane: two departments talking to
 * each other and each talking to Central are separate threads, and reading one
 * must not clear another.
 */
export async function markConversationRead(
  userId: string,
  orderId: string,
  peer: string
): Promise<void> {
  if (!isPeer(peer)) return;
  await query(
    `INSERT INTO order_message_reads (user_id, order_id, dept_role, last_read_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, order_id, dept_role)
     DO UPDATE SET last_read_at = now()`,
    [userId, orderId, peer]
  );
}
