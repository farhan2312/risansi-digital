import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canAccessComplaint, hasRole } from '@/lib/risansi-auth';

export const runtime = 'nodejs';

async function resolve(photoId: number) {
  const { rows } = await risansiPool.query<{ complaint_id: number }>(
    'SELECT complaint_id FROM complaint_photos WHERE id = $1', [photoId]);
  const r = rows[0];
  if (!r) return null;
  const user = await getCurrentUser();
  if (!user.email || !(await canAccessComplaint(user, r.complaint_id))) return null;
  return { user, complaintId: r.complaint_id };
}

// Serve the image bytes.
export async function GET(_req: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params;
  const id = Number(photoId);
  if (!Number.isInteger(id)) return new Response('Bad id', { status: 400 });
  if (!(await resolve(id))) return new Response('Not found', { status: 404 });

  const { rows } = await risansiPool.query<{ image_bytes: Buffer; mime_type: string }>(
    'SELECT image_bytes, mime_type FROM complaint_photos WHERE id = $1', [id]);
  const p = rows[0];
  if (!p) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(p.image_bytes), {
    headers: {
      'Content-Type': p.mime_type || 'image/jpeg',
      'Content-Length': String(p.image_bytes.length),
      'Cache-Control': 'private, max-age=86400',
    },
  });
}

// Delete a photo (uploader or admin).
export async function DELETE(_req: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params;
  const id = Number(photoId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  const access = await resolve(id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { rows } = await risansiPool.query<{ uploaded_by: string | null }>(
    'SELECT uploaded_by FROM complaint_photos WHERE id = $1', [id]);
  const isOwner = rows[0]?.uploaded_by && access.user.email && rows[0].uploaded_by.toLowerCase() === access.user.email.toLowerCase();
  if (!isOwner && !hasRole(access.user.role, 'admin')) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }
  await risansiPool.query('DELETE FROM complaint_photos WHERE id = $1', [id]);
  return NextResponse.json({ ok: true });
}
