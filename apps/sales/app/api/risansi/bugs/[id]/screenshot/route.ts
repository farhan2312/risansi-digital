import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { serveBugScreenshot } from '@/lib/risansi-bug-screenshot';

export const runtime = 'nodejs';

// GET — stream a bug's first screenshot inline. The system admin (who works the
// queue) or the original reporter may view it.
//
// A bug can carry several screenshots now, each addressed by its own id through
// /api/risansi/bug-screenshot/<shotId>. This route predates that and is what
// every link filed before the change points at, so it answers with the oldest
// shot on the bug — which, for those reports, is the only one there is.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bugId = parseInt(id, 10);
  if (!Number.isInteger(bugId)) return new NextResponse('Bad id', { status: 400 });

  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  const bug = (await risansiPool.query<{ reporter_id: number | null }>(
    'SELECT reporter_id FROM bugs WHERE id = $1', [bugId],
  )).rows[0];
  if (!bug) return new NextResponse('Not found', { status: 404 });

  const isReporter = user.id != null && bug.reporter_id != null && Number(bug.reporter_id) === Number(user.id);
  if (!hasRole(user.role, 'sysadmin') && !isReporter) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const rec = (await risansiPool.query<{ file_name: string; mime: string; bytes: Buffer }>(
    'SELECT file_name, mime, bytes FROM bug_screenshots WHERE bug_id = $1 ORDER BY id LIMIT 1', [bugId],
  )).rows[0];
  if (!rec) return new NextResponse('No screenshot', { status: 404 });

  return serveBugScreenshot(rec);
}
