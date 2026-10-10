import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canViewClient, hasRole } from '@/lib/risansi-auth';
import { recordAudit } from '@/lib/audit';

// Reading uploaded bytes + writing bytea needs the Node runtime, not edge.
export const runtime = 'nodejs';

const MAX_BYTES = 15_000_000;
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);

interface PhotoRow {
  id: number; mime_type: string; byte_size: number;
  caption: string; uploaded_by: string | null; uploaded_at: string;
}

/**
 * Resolve the visit and confirm the signed-in user may access it.
 * Returns the client_id + whether the visit is already submitted (read-only),
 * or null when the visit doesn't exist or the user can't see its client.
 */
async function checkVisitAccess(visitId: number) {
  const { rows } = await risansiPool.query<{ client_id: number; submitted_at: string | null }>(
    'SELECT client_id, submitted_at FROM visits WHERE id = $1',
    [visitId],
  );
  const v = rows[0];
  if (!v) return null;
  const user = await getCurrentUser();
  if (!user.email) return null;
  const can = await canViewClient(user, v.client_id);
  if (!can) return null;
  return { user, clientId: v.client_id, submitted: !!v.submitted_at };
}

// ── List photos for a visit (metadata only; bytes served separately) ──
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ visitId: string }> },
) {
  const { visitId } = await params;
  const id = Number(visitId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Bad visit id' }, { status: 400 });

  const access = await checkVisitAccess(id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { rows } = await risansiPool.query<PhotoRow>(
    `SELECT id, mime_type, byte_size, COALESCE(caption, '') AS caption, uploaded_by, uploaded_at
       FROM visit_photos
      WHERE visit_id = $1
      ORDER BY uploaded_at, id`,
    [id],
  );
  return NextResponse.json({ photos: rows });
}

// ── Upload a new photo (multipart/form-data: photo, optional caption) ──
export async function POST(
  req: Request,
  { params }: { params: Promise<{ visitId: string }> },
) {
  try {
    const { visitId } = await params;
    const id = Number(visitId);
    if (!Number.isInteger(id)) return NextResponse.json({ error: 'Bad visit id' }, { status: 400 });

    const access = await checkVisitAccess(id);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Submitted reports are read-only except for admins.
    if (access.submitted && !hasRole(access.user.role, 'admin')) {
      return NextResponse.json({ error: 'Visit is submitted (read-only)' }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get('photo');
    const caption = ((form.get('caption') as string | null) ?? '').slice(0, 500);

    if (!(file instanceof File)) return NextResponse.json({ error: 'No photo provided' }, { status: 400 });

    const mime = file.type || 'image/jpeg';
    if (!ALLOWED_MIME.has(mime)) return NextResponse.json({ error: 'Unsupported image type' }, { status: 415 });

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 });
    if (buf.length > MAX_BYTES) return NextResponse.json({ error: 'Image too large (max 15 MB)' }, { status: 413 });

    const { rows } = await risansiPool.query<PhotoRow>(
      `INSERT INTO visit_photos (visit_id, image_bytes, mime_type, byte_size, caption, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, mime_type, byte_size, COALESCE(caption, '') AS caption, uploaded_by, uploaded_at`,
      [id, buf, mime, buf.length, caption, access.user.email],
    );

    await recordAudit({
      action: 'create', entityType: 'visit_photo', entityId: rows[0].id,
      summary: `Added a photo to visit #${id}`,
      actorEmail: access.user.email, actorRole: access.user.role,
    });

    return NextResponse.json({ photo: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('Photo upload error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
