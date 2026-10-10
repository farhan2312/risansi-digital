import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canViewClient, hasRole } from '@/lib/risansi-auth';
import { recordAudit } from '@/lib/audit';

// Serving bytea needs the Node runtime, not edge.
export const runtime = 'nodejs';

/**
 * Resolve a photo's owning visit and confirm the user may access it.
 * Returns the actor + visit id + submitted flag, or null when the photo is
 * missing or the user can't see its client.
 */
async function checkPhotoAccess(photoId: number) {
  const { rows } = await risansiPool.query<{ visit_id: number; client_id: number; submitted_at: string | null }>(
    `SELECT p.visit_id, v.client_id, v.submitted_at
       FROM visit_photos p
       JOIN visits v ON v.id = p.visit_id
      WHERE p.id = $1`,
    [photoId],
  );
  const r = rows[0];
  if (!r) return null;
  const user = await getCurrentUser();
  if (!user.email) return null;
  const can = await canViewClient(user, r.client_id);
  if (!can) return null;
  return { user, visitId: r.visit_id, submitted: !!r.submitted_at };
}

// ── Serve the image bytes ──
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ photoId: string }> },
) {
  const { photoId } = await params;
  const id = Number(photoId);
  if (!Number.isInteger(id)) return new Response('Bad id', { status: 400 });

  const access = await checkPhotoAccess(id);
  if (!access) return new Response('Not found', { status: 404 });

  const { rows } = await risansiPool.query<{ image_bytes: Buffer; mime_type: string }>(
    'SELECT image_bytes, mime_type FROM visit_photos WHERE id = $1',
    [id],
  );
  const p = rows[0];
  if (!p) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(p.image_bytes), {
    headers: {
      'Content-Type': p.mime_type || 'image/jpeg',
      'Content-Length': String(p.image_bytes.length),
      // Private: these are per-visit field photos, never publicly cacheable.
      'Cache-Control': 'private, max-age=86400',
    },
  });
}

// ── Update a photo's caption (the rep's free-text addition) ──
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ photoId: string }> },
) {
  const { photoId } = await params;
  const id = Number(photoId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const access = await checkPhotoAccess(id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (access.submitted && !hasRole(access.user.role, 'admin')) {
    return NextResponse.json({ error: 'Visit is submitted (read-only)' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const caption = (typeof body.caption === 'string' ? body.caption : '').slice(0, 500);

  await risansiPool.query('UPDATE visit_photos SET caption = $1 WHERE id = $2', [caption, id]);
  return NextResponse.json({ ok: true, caption });
}

// ── Delete a photo ──
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ photoId: string }> },
) {
  const { photoId } = await params;
  const id = Number(photoId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const access = await checkPhotoAccess(id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (access.submitted && !hasRole(access.user.role, 'admin')) {
    return NextResponse.json({ error: 'Visit is submitted (read-only)' }, { status: 403 });
  }

  await risansiPool.query('DELETE FROM visit_photos WHERE id = $1', [id]);
  await recordAudit({
    action: 'delete', entityType: 'visit_photo', entityId: id,
    summary: `Removed a photo from visit #${access.visitId}`,
    actorEmail: access.user.email, actorRole: access.user.role,
  });
  return NextResponse.json({ ok: true });
}
