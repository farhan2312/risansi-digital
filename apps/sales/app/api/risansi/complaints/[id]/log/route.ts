import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canAccessComplaint } from '@/lib/risansi-auth';

export const runtime = 'nodejs';

// Updates timeline + photo metadata for one complaint (access-checked).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cid = Number(id);
  if (!Number.isInteger(cid)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const user = await getCurrentUser();
  if (!user.email || !(await canAccessComplaint(user, cid))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [updates, photos] = await Promise.all([
    risansiPool.query(
      `SELECT id, body, entry_date::text AS entry_date, created_by, created_at::text AS created_at
         FROM complaint_updates WHERE complaint_id = $1
        ORDER BY COALESCE(entry_date::timestamptz, created_at), id`,
      [cid],
    ),
    risansiPool.query(
      `SELECT id, mime_type, byte_size, COALESCE(caption,'') AS caption, uploaded_by, uploaded_at::text AS uploaded_at
         FROM complaint_photos WHERE complaint_id = $1 ORDER BY uploaded_at, id`,
      [cid],
    ),
  ]);
  return NextResponse.json({ updates: updates.rows, photos: photos.rows });
}
