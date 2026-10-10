import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { serveBugScreenshot } from '@/lib/risansi-bug-screenshot';

export const runtime = 'nodejs';

// GET — stream one screenshot by its own id, the way complaint attachments are
// served. A bug can carry several now, so /api/risansi/bugs/<id>/screenshot can
// no longer name a particular one; it stays for the first shot and old links.
export async function GET(_req: Request, { params }: { params: Promise<{ shotId: string }> }) {
  const { shotId } = await params;
  const id = parseInt(shotId, 10);
  if (!Number.isInteger(id)) return new NextResponse('Bad id', { status: 400 });

  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  const rec = (await risansiPool.query<{ file_name: string; mime: string; bytes: Buffer; reporter_id: number | null }>(
    `SELECT s.file_name, s.mime, s.bytes, b.reporter_id
       FROM bug_screenshots s
       JOIN bugs b ON b.id = s.bug_id
      WHERE s.id = $1`, [id],
  )).rows[0];
  if (!rec) return new NextResponse('Not found', { status: 404 });

  // Same rule as the bug itself: the system admin who works the queue, or the
  // person who filed it.
  const isReporter = user.id != null && rec.reporter_id != null && Number(rec.reporter_id) === Number(user.id);
  if (!hasRole(user.role, 'sysadmin') && !isReporter) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  return serveBugScreenshot(rec);
}
