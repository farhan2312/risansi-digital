import { desc, eq } from "drizzle-orm";

import { attachmentToDict, error, json } from "@/lib/api";
import { getClientIp, logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { requisitionAttachments, users } from "@/lib/db/schema";
import { findRequisitionByIdOrNo } from "@/lib/requisitionLookup";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4MB -- see schema.ts comment on requisitionAttachments.
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Same rule PATCH already applies to requisition intake fields: source can
 * only touch requisitions they raised themselves; central-admin and admin
 * can touch any. Testing team can view/open attachments but never upload. */
function canManageAttachments(
  role: string,
  createdBy: string | null,
  userId: string
): boolean {
  if (role === "admin" || role === "central-admin") return true;
  if (role === "source") return createdBy === userId;
  return false;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { id: idOrNo } = await params;
  const requisition = await findRequisitionByIdOrNo(idOrNo);
  if (!requisition) return error("Requisition not found", 404);
  if (claims.role === "source" && requisition.createdBy !== claims.sub) {
    return error("You can only view requisitions you raised.", 403);
  }
  const id = requisition.id;

  const rows = await db
    .select({
      id: requisitionAttachments.id,
      requisitionId: requisitionAttachments.requisitionId,
      fileName: requisitionAttachments.fileName,
      mimeType: requisitionAttachments.mimeType,
      fileSize: requisitionAttachments.fileSize,
      uploadedBy: requisitionAttachments.uploadedBy,
      uploadedByName: requisitionAttachments.uploadedByName,
      createdAt: requisitionAttachments.createdAt,
    })
    .from(requisitionAttachments)
    .where(eq(requisitionAttachments.requisitionId, id))
    .orderBy(desc(requisitionAttachments.createdAt));

  return json(rows.map(attachmentToDict));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { id: idOrNo } = await params;
  const requisition = await findRequisitionByIdOrNo(idOrNo);
  if (!requisition) return error("Requisition not found", 404);
  if (!canManageAttachments(claims.role, requisition.createdBy, claims.sub)) {
    return error("You don't have permission to attach files to this testing summary.", 403);
  }
  const id = requisition.id;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return error("Request must be multipart/form-data", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return error("'file' is required", 400);
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return error("Only PDF and image files (JPEG/PNG/WEBP/GIF) are allowed.", 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return error("File exceeds the 4MB limit.", 400);
  }
  if (file.size === 0) {
    return error("File is empty.", 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const [uploader] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  const uploadedByName = uploader?.name ?? claims.email;

  const [attachment] = await db
    .insert(requisitionAttachments)
    .values({
      requisitionId: id,
      fileName: file.name || "attachment",
      mimeType: file.type,
      fileSize: file.size,
      fileData: buffer,
      uploadedBy: claims.sub,
      uploadedByName,
    })
    .returning({
      id: requisitionAttachments.id,
      requisitionId: requisitionAttachments.requisitionId,
      fileName: requisitionAttachments.fileName,
      mimeType: requisitionAttachments.mimeType,
      fileSize: requisitionAttachments.fileSize,
      uploadedBy: requisitionAttachments.uploadedBy,
      uploadedByName: requisitionAttachments.uploadedByName,
      createdAt: requisitionAttachments.createdAt,
    });

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userName: uploadedByName,
    userEmail: claims.email,
    eventType: "create",
    entityType: "attachment",
    entityId: attachment.id,
    entityLabel: attachment.fileName,
    details: `Uploaded to requisition ${requisition.model}`,
  });

  return json(attachmentToDict(attachment), 201);
}
