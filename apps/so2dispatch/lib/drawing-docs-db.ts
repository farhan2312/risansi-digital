import "server-only";
import { query } from "@/lib/db";
import { seesAllDrawingDocs, type DrawingDocument } from "@/lib/drawing-docs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS = `d.id, d.revision_id, d.item_id, d.doc_type, d.link,
       d.assigned_roles, d.remarks,
       to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
       rv.revision_no, rv.seq::int AS revision_seq`;

/**
 * The documents a viewer may see: all of them for Drawing and Central, only
 * those assigned to their role for anyone else. $2 is that role, or null when
 * no filter applies.
 */
function visibleTo(role: string): string | null {
  return seesAllDrawingDocs(role) ? null : role;
}

export async function listRevisionDocuments(
  revisionId: string,
  viewerRole: string
): Promise<DrawingDocument[]> {
  if (!UUID_RE.test(revisionId)) return [];
  const r = await query<DrawingDocument>(
    `SELECT ${COLUMNS}
       FROM order_drawing_documents d
       JOIN order_drawing_revisions rv ON rv.id = d.revision_id
      WHERE d.revision_id = $1
        AND ($2::text IS NULL OR $2 = ANY(d.assigned_roles))
      ORDER BY d.created_at DESC`,
    [revisionId, visibleTo(viewerRole)]
  );
  return r.rows;
}

/** Every document on an EC, across its revisions, newest revision first. */
export async function listEcDocuments(
  itemId: string,
  viewerRole: string
): Promise<DrawingDocument[]> {
  if (!UUID_RE.test(itemId)) return [];
  const r = await query<DrawingDocument>(
    `SELECT ${COLUMNS}
       FROM order_drawing_documents d
       JOIN order_drawing_revisions rv ON rv.id = d.revision_id
      WHERE d.item_id = $1
        AND ($2::text IS NULL OR $2 = ANY(d.assigned_roles))
      ORDER BY rv.seq DESC, d.created_at DESC`,
    [itemId, visibleTo(viewerRole)]
  );
  return r.rows;
}

/** How many documents each EC holds for this viewer — for the button badges. */
export async function countEcDocuments(
  itemIds: string[],
  viewerRole: string
): Promise<Record<string, number>> {
  const ids = itemIds.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return {};
  const r = await query<{ item_id: string; n: number }>(
    `SELECT item_id, count(*)::int AS n
       FROM order_drawing_documents
      WHERE item_id = ANY($1::uuid[])
        AND ($2::text IS NULL OR $2 = ANY(assigned_roles))
      GROUP BY item_id`,
    [ids, visibleTo(viewerRole)]
  );
  return Object.fromEntries(r.rows.map((x) => [x.item_id, x.n]));
}

/** The revision a document is being added to, and the EC it belongs to. */
export async function revisionContext(revisionId: string): Promise<{
  item_id: string;
  order_id: string;
  so_no: string;
  ec_no: string | null;
  revision_no: string | null;
  revision_seq: number;
} | null> {
  if (!UUID_RE.test(revisionId)) return null;
  const r = await query<{
    item_id: string;
    order_id: string;
    so_no: string;
    ec_no: string | null;
    revision_no: string | null;
    revision_seq: number;
  }>(
    `SELECT rv.item_id, it.order_id, COALESCE(o.so_no, '#' || o.sl_no) AS so_no,
            it.ec_no, rv.revision_no, rv.seq::int AS revision_seq
       FROM order_drawing_revisions rv
       JOIN order_items it ON it.id = rv.item_id
       JOIN orders o ON o.id = it.order_id
      WHERE rv.id = $1`,
    [revisionId]
  );
  return r.rows[0] ?? null;
}

export async function insertDrawingDocument(input: {
  revisionId: string;
  itemId: string;
  docType: string;
  link: string;
  assignedRoles: string[];
  remarks: string | null;
  actorId: string;
  actorRole: string;
}): Promise<string> {
  const r = await query<{ id: string }>(
    `INSERT INTO order_drawing_documents
       (revision_id, item_id, doc_type, link, assigned_roles, remarks,
        created_by, created_by_role)
     VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8)
     RETURNING id`,
    [
      input.revisionId,
      input.itemId,
      input.docType,
      input.link,
      input.assignedRoles,
      input.remarks,
      input.actorId,
      input.actorRole,
    ]
  );
  return r.rows[0].id;
}

/** Delete one document, handing back what it was so the removal can be logged. */
export async function deleteDrawingDocument(
  id: string
): Promise<{ revision_id: string; doc_type: string } | null> {
  if (!UUID_RE.test(id)) return null;
  const r = await query<{ revision_id: string; doc_type: string }>(
    `DELETE FROM order_drawing_documents WHERE id = $1
     RETURNING revision_id, doc_type`,
    [id]
  );
  return r.rows[0] ?? null;
}
