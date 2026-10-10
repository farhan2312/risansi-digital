import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canAccessComplaint } from '@/lib/risansi-auth';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const MAX_BYTES = 15_000_000;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

// Upload a photo to a complaint (multipart: photo, optional caption).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const cid = Number(id);
    if (!Number.isInteger(cid)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

    const user = await getCurrentUser();
    if (!user.email || !(await canAccessComplaint(user, cid))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
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

    const { rows } = await risansiPool.query(
      `INSERT INTO complaint_photos (complaint_id, image_bytes, mime_type, byte_size, caption, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, mime_type, byte_size, COALESCE(caption,'') AS caption, uploaded_by, uploaded_at::text AS uploaded_at`,
      [cid, buf, mime, buf.length, caption, user.email],
    );
    await recordAudit({
      action: 'create', entityType: 'complaint_photo', entityId: rows[0].id,
      summary: `Added a photo to complaint #${cid}`, actorEmail: user.email, actorRole: user.role,
    });
    return NextResponse.json({ photo: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('Complaint photo upload error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
