import { query } from "@/lib/db";
import { isCentral } from "@/lib/roles";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChatContact = {
  id: string;
  full_name: string;
  email: string;
  role: string;
};

export type ChatMessage = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  mine: boolean;
};

export type ChatConversation = ChatContact & {
  last_body: string | null;
  last_at: string | null;
  unread: number;
};

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/**
 * Who a role is allowed to exchange messages with. Central Visibility / Admin
 * talk to department users; department users talk only to Central Visibility /
 * Admin. That single rule enforces both halves of the requirement — and means
 * a department user can never message another department.
 */
export function canMessage(myRole: string, theirRole: string): boolean {
  return isCentral(myRole) !== isCentral(theirRole);
}

/** SQL fragment matching the roles the given user may message. */
function counterpartRoleFilter(myRole: string): string {
  return isCentral(myRole)
    ? `u.role NOT IN ('admin', 'central_visibility')`
    : `u.role IN ('admin', 'central_visibility')`;
}

/**
 * People the user may start a conversation with, newest-active first.
 * `search` filters on name / email / role (Central Visibility searching for a
 * department user); an empty search returns everyone allowed.
 */
export async function listContacts(
  userId: string,
  myRole: string,
  search = ""
): Promise<ChatContact[]> {
  const term = search.trim();
  const result = await query<ChatContact>(
    `SELECT u.id, u.full_name, u.email, u.role
       FROM users u
      WHERE u.status = 'approved'
        AND u.id <> $1
        AND ${counterpartRoleFilter(myRole)}
        AND ($2 = '' OR u.full_name ILIKE '%' || $2 || '%'
                     OR u.email     ILIKE '%' || $2 || '%'
                     OR u.role      ILIKE '%' || $2 || '%')
      ORDER BY u.full_name ASC`,
    [userId, term]
  );
  return result.rows;
}

/**
 * Existing threads for the user: the other client_name, the last message, and how
 * many of their messages are still unread.
 */
export async function listConversations(
  userId: string,
  myRole: string
): Promise<ChatConversation[]> {
  const result = await query<ChatConversation>(
    `WITH threads AS (
        SELECT CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END AS other_id,
               m.body,
               m.created_at,
               (m.recipient_id = $1 AND m.read_at IS NULL) AS is_unread
          FROM chat_messages m
         WHERE m.sender_id = $1 OR m.recipient_id = $1
     )
     SELECT u.id, u.full_name, u.email, u.role,
            (SELECT t2.body FROM threads t2 WHERE t2.other_id = u.id
              ORDER BY t2.created_at DESC LIMIT 1) AS last_body,
            to_char(max(t.created_at) AT TIME ZONE 'UTC', ${ISO}) AS last_at,
            count(*) FILTER (WHERE t.is_unread)::int AS unread
       FROM threads t
       JOIN users u ON u.id = t.other_id
      WHERE ${counterpartRoleFilter(myRole)}
      GROUP BY u.id, u.full_name, u.email, u.role
      ORDER BY max(t.created_at) DESC`,
    [userId]
  );
  return result.rows;
}

/**
 * Messages between the user and one counterpart, oldest first. `afterId`
 * returns only messages newer than that id — the long-poll uses this to fetch
 * just the new tail.
 */
export async function listThread(
  userId: string,
  otherId: string,
  afterId?: string
): Promise<ChatMessage[]> {
  if (!UUID_RE.test(otherId)) return [];
  const after = afterId && UUID_RE.test(afterId) ? afterId : null;
  const result = await query<ChatMessage>(
    `SELECT m.id, m.sender_id, m.recipient_id, m.body,
            to_char(m.created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at,
            (m.sender_id = $1) AS mine
       FROM chat_messages m
      WHERE ((m.sender_id = $1 AND m.recipient_id = $2)
          OR (m.sender_id = $2 AND m.recipient_id = $1))
        AND ($3::uuid IS NULL
             OR m.created_at > (SELECT created_at FROM chat_messages WHERE id = $3))
      ORDER BY m.created_at ASC
      LIMIT 500`,
    [userId, otherId, after]
  );
  return result.rows;
}

/** Insert a message. Caller must have already checked `canMessage`. */
export async function sendMessage(
  senderId: string,
  recipientId: string,
  body: string
): Promise<ChatMessage | null> {
  if (!UUID_RE.test(recipientId)) return null;
  const text = body.trim();
  if (text === "") return null;
  const result = await query<ChatMessage>(
    `INSERT INTO chat_messages (sender_id, recipient_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, sender_id, recipient_id, body,
               to_char(created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at,
               true AS mine`,
    [senderId, recipientId, text.slice(0, 4000)]
  );
  return result.rows[0] ?? null;
}

/** Mark everything the counterpart sent me as read. */
export async function markThreadRead(
  userId: string,
  otherId: string
): Promise<void> {
  if (!UUID_RE.test(otherId)) return;
  await query(
    `UPDATE chat_messages SET read_at = now()
      WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL`,
    [userId, otherId]
  );
}

/** Total unread messages, for the sidebar badge. */
export async function countUnreadMessages(userId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM chat_messages
      WHERE recipient_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** The id of the newest message in a thread, or null. Used to seed a poll. */
export async function latestMessageId(
  userId: string,
  otherId: string
): Promise<string | null> {
  if (!UUID_RE.test(otherId)) return null;
  const result = await query<{ id: string }>(
    `SELECT id FROM chat_messages
      WHERE (sender_id = $1 AND recipient_id = $2)
         OR (sender_id = $2 AND recipient_id = $1)
      ORDER BY created_at DESC LIMIT 1`,
    [userId, otherId]
  );
  return result.rows[0]?.id ?? null;
}

/** Look up one messageable counterpart (also validates the pairing rule). */
export async function getContact(
  myRole: string,
  otherId: string
): Promise<ChatContact | null> {
  if (!UUID_RE.test(otherId)) return null;
  const result = await query<ChatContact>(
    `SELECT id, full_name, email, role FROM users
      WHERE id = $1 AND status = 'approved' LIMIT 1`,
    [otherId]
  );
  const contact = result.rows[0];
  if (!contact || !canMessage(myRole, contact.role)) return null;
  return contact;
}
