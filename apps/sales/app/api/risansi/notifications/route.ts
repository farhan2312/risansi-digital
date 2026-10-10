import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';

// The bell's data source. GET returns the current user's recent feed + unread
// count; POST marks items read. Everything is scoped to the SIGNED-IN user's id
// from the session — a caller can never read or touch another user's feed,
// because user_id is never taken from the request.

export const dynamic = 'force-dynamic';

const FEED_LIMIT = 30;

export async function GET() {
  const user = await getCurrentUser();
  if (user.id == null) return NextResponse.json({ items: [], unread: 0 }, { status: 401 });

  const [items, unread] = await Promise.all([
    risansiPool.query(
      `SELECT id, kind, section, title, body, link, actor, read_at::text AS read_at, created_at::text AS created_at
         FROM notifications WHERE user_id = $1
        ORDER BY created_at DESC LIMIT ${FEED_LIMIT}`,
      [user.id],
    ).then(r => r.rows).catch(() => []),
    risansiPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [user.id],
    ).then(r => r.rows[0]?.n ?? 0).catch(() => 0),
  ]);

  return NextResponse.json({ items, unread });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (user.id == null) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { action?: string; ids?: number[] } = {};
  try { body = await req.json(); } catch { /* empty body → treat as mark-all */ }

  try {
    if (body.action === 'read' && Array.isArray(body.ids) && body.ids.length) {
      // Only the caller's own rows can be touched: user_id is pinned to the session.
      const ids = body.ids.filter(n => Number.isInteger(n)).slice(0, 100);
      await risansiPool.query(
        `UPDATE notifications SET read_at = NOW()
          WHERE user_id = $1 AND id = ANY($2::int[]) AND read_at IS NULL`,
        [user.id, ids],
      );
    } else {
      // Mark all read.
      await risansiPool.query(
        `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
        [user.id],
      );
    }
  } catch (e) {
    console.error('[notifications] mark-read failed', e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const unread = await risansiPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [user.id],
  ).then(r => r.rows[0]?.n ?? 0).catch(() => 0);

  return NextResponse.json({ ok: true, unread });
}
