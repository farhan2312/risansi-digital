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
 * talking to each other is theirs alone. Each side also has a conversation
 * with itself — its own team — stored with itself on both sides
 * (dept_role = to_role).
 *
 * Its author may edit an entry (it then says so) or delete it — Admin may
 * delete any — see editMessage / deleteMessage.
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
  /** When its author last changed it, or null. */
  edited_at: string | null;
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
            to_char(m.created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at,
            to_char(m.edited_at AT TIME ZONE 'UTC', ${ISO}) AS edited_at`;

export const MAX_MESSAGE_LENGTH = 2000;

/**
 * The side of a conversation a role speaks for. A Rep Manager is on the Reps'
 * side: the "rep" lane, scoped to their team's SOs by the callers (repOwns),
 * so a manager and their reps read the same conversations rather than a
 * second, empty lane.
 */
export function laneOf(role: string): string {
  return role === "rep_manager" ? "rep" : role;
}

/** The department roles a conversation can be with — every non-central role that is its own side (CRM only reads). */
export const DEPARTMENT_LANES: Role[] = ALL_ROLES.filter((r) => !isCentral(r) && r !== "crm" && laneOf(r) === r);

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
 * A department talks to its own team, every other department and Central;
 * Central talks to its own team and each department.
 */
export function peersFor(role: string): string[] {
  role = laneOf(role);
  if (isCentral(role)) return [CENTRAL_PEER, ...DEPARTMENT_LANES];
  if (!isDepartmentLane(role)) return [];
  return [role, ...DEPARTMENT_LANES.filter((r) => r !== role), CENTRAL_PEER];
}

/**
 * Whether a delay may be logged in this conversation: in any of them — with
 * Central or department to department — a department can say what is holding
 * it up, and the delay goes on the SO's delay log.
 */
export function canLogDelay(role: string, peer: string): boolean {
  return canUsePeer(role, peer);
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
    // Central's own team: Central on both sides.
    return `((m.dept_role = ${peerParam} AND m.to_role IS NULL)
            OR (${peerParam} = '${CENTRAL_PEER}' AND m.dept_role = '${CENTRAL_PEER}' AND m.to_role = '${CENTRAL_PEER}'))`;
  }
  // One side wrote to the other — which, with peer = role, is the own team.
  return `((m.dept_role = ${peerParam} AND COALESCE(m.to_role, '${CENTRAL_PEER}') = ${roleParam})
           OR (m.dept_role = ${roleParam} AND COALESCE(m.to_role, '${CENTRAL_PEER}') = ${peerParam}))`;
}

/** Every message this user may see at all, whatever conversation it is in. */
function visibleSql(viewerRole: string, roleParam: string) {
  // Central is a party to exactly the messages that name no other recipient,
  // and to its own team's.
  if (isCentral(viewerRole)) {
    return `(m.to_role IS NULL OR (m.dept_role = '${CENTRAL_PEER}' AND m.to_role = '${CENTRAL_PEER}'))`;
  }
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
  return { param: `$${params.length + 1}`, params: [...params, laneOf(viewer.role)] };
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
 * long poll: the newest entry, how many there are and the latest edit, so a
 * message arriving, changed or deleted in any conversation on the order — not
 * just the one on screen — moves it.
 */
export async function latestActivity(
  orderId: string,
  viewer: { id: string; role: string }
): Promise<string | null> {
  if (peersFor(viewer.role).length === 0) return null;
  const { param, params } = withRole(viewer, [orderId]);
  const result = await query<{ at: string | null }>(
    `SELECT CASE WHEN count(*) = 0 THEN NULL ELSE
              concat_ws('|', to_char(MAX(m.created_at) AT TIME ZONE 'UTC', ${ISO}), count(*),
                        to_char(MAX(m.edited_at) AT TIME ZONE 'UTC', ${ISO})) END AS at
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

/** One conversation on one SO, for the All chats list. */
export type ChatSummary = {
  order_id: string;
  so_no: string | null;
  sl_no: number;
  client_name: string | null;
  reps: string | null;
  so_assignee_id: string | null;
  /** The other side, from the viewer's (the viewer's own lane: their own team). */
  peer: string;
  total: number;
  unread: number;
  last_at: string;
  last_body: string;
  last_author: string;
};

/** One page of the All chats list, and the unread total across all of it. */
export type ChatPage = { chats: ChatSummary[]; hasMore: boolean; unread: number };

/**
 * Every conversation the viewer is in, across all SOs, latest first — the
 * All chats list, a page at a time. Read state is the same as the SO's own
 * chat. A search matches the SO No., client, the department or any message
 * (or its author); `peerHits` are the departments whose name matched.
 */
export async function listAllChats(
  viewer: { id: string; role: string },
  opts: {
    offset?: number;
    limit?: number;
    search?: string;
    peerHits?: string[];
    unreadOnly?: boolean;
    /** A Rep: only SOs whose Rep is one of these. */
    repNames?: string[];
    /** An Order Making SO member: only the SOs assigned to them. */
    assigneeId?: string;
  } = {}
): Promise<ChatPage> {
  const peers = peersFor(viewer.role);
  if (peers.length === 0) return { chats: [], hasMore: false, unread: 0 };
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const search = (opts.search ?? "").trim();
  const params: unknown[] = [viewer.id, peers];
  const add = (v: unknown) => `$${params.push(v)}`;
  const scope: string[] = [];
  if (opts.repNames) scope.push(`lower(btrim(COALESCE(o.reps, ''))) = ANY(${add(opts.repNames.map((n) => n.trim().toLowerCase()))}::text[])`);
  if (opts.assigneeId) scope.push(`o.so_assignee_id = ${add(opts.assigneeId)}`);
  const like = search ? add(`%${search.replace(/[\%_]/g, (c) => `\${c}`)}%`) : "";
  const hits = search ? add(opts.peerHits ?? []) : "";
  const outer: string[] = [];
  if (search) {
    outer.push(`(c.hit OR c.so_no ILIKE ${like} OR c.client_name ILIKE ${like} OR c.peer = ANY(${hits}::text[]))`);
  }
  if (opts.unreadOnly) outer.push("c.unread > 0");
  const lim = add(limit + 1);
  const off = add(offset);
  const { param, params: all } = withRole(viewer, params);
  const peerOf = peerOfSql(viewer.role, param);
  const result = await query<ChatSummary & { all_unread: number }>(
    `WITH c AS (
       SELECT m.order_id, o.so_no, o.sl_no::int AS sl_no, o.client_name, o.reps,
              o.so_assignee_id::text AS so_assignee_id,
              ${peerOf} AS peer,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (
                WHERE m.author_id <> $1
                  AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
              )::int AS unread,
              MAX(m.created_at) AS last_ts,
              to_char(MAX(m.created_at) AT TIME ZONE 'UTC', ${ISO}) AS last_at,
              (ARRAY_AGG(m.body ORDER BY m.created_at DESC))[1] AS last_body,
              (ARRAY_AGG(m.author_name ORDER BY m.created_at DESC))[1] AS last_author,
              ${search ? `bool_or(m.body ILIKE ${like} OR m.author_name ILIKE ${like})` : "false"} AS hit
         FROM order_messages m
         JOIN orders o ON o.id = m.order_id
         LEFT JOIN order_message_reads r
                ON r.user_id = $1
               AND r.order_id = m.order_id
               AND r.dept_role = ${peerOf}
        WHERE ${visibleSql(viewer.role, param)}
          ${scope.map((s) => `AND ${s}`).join(" ")}
        GROUP BY m.order_id, o.so_no, o.sl_no, o.client_name, o.reps, o.so_assignee_id, 7
     ),
     -- Only conversations the viewer may still open.
     v AS (SELECT * FROM c WHERE c.peer = ANY($2::text[]))
     SELECT c.*, (SELECT COALESCE(SUM(unread), 0) FROM v)::int AS all_unread
       FROM v c
      ${outer.length ? `WHERE ${outer.join(" AND ")}` : ""}
      ORDER BY c.last_ts DESC, c.order_id, c.peer
      LIMIT ${lim} OFFSET ${off}`,
    all
  );
  const rows = result.rows;
  return {
    chats: rows.slice(0, limit),
    hasMore: rows.length > limit,
    // A filtered page may be empty while other chats are unread.
    unread: rows[0]?.all_unread ?? (outer.length || offset ? await listAllChatsUnread(viewer, opts) : 0),
  };
}

/** The unread total alone, when a page came back empty. */
async function listAllChatsUnread(
  viewer: { id: string; role: string },
  opts: { repNames?: string[]; assigneeId?: string }
): Promise<number> {
  const page = await listAllChats(viewer, { repNames: opts.repNames, assigneeId: opts.assigneeId, limit: 1 });
  return page.unread;
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
  role = laneOf(role);
  if (!canUsePeer(role, peer) || !isPeer(peer)) return null;
  // Central's own team: Central on both sides.
  if (isCentral(role)) return peer === CENTRAL_PEER ? { deptRole: CENTRAL_PEER, toRole: CENTRAL_PEER } : { deptRole: peer, toRole: null };
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
               NULL::text AS edited_at,
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

/** What an edit or a delete touched: where it was, and what it said before. */
export type ChangedMessage = { order_id: string; dept_role: string; to_role: string | null; kind: string; body: string };

/** Change an entry's text — its author's own only. Null when it is not theirs (or gone). */
export async function editMessage(id: string, authorId: string, body: string): Promise<ChangedMessage | null> {
  const result = await query<ChangedMessage>(
    `UPDATE order_messages m SET body = $3, edited_at = now()
       FROM (SELECT id, body FROM order_messages WHERE id = $1) old
      WHERE m.id = old.id AND m.author_id = $2
      RETURNING m.order_id, m.dept_role, m.to_role, m.kind, old.body`,
    [id, authorId, body]
  );
  return result.rows[0] ?? null;
}

/** Delete an entry: its author's own, or any (Admin). Null when not allowed (or gone). */
export async function deleteMessage(id: string, actorId: string, any: boolean): Promise<ChangedMessage | null> {
  const result = await query<ChangedMessage>(
    `DELETE FROM order_messages WHERE id = $1 AND ($3 OR author_id = $2)
      RETURNING order_id, dept_role, to_role, kind, body`,
    [id, actorId, any]
  );
  return result.rows[0] ?? null;
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
