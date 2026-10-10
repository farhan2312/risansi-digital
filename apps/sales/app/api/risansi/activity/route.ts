import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

export const runtime = 'nodejs';

// Records active-time beacons from the client ActivityTracker. Body is JSON
// (sent via sendBeacon or fetch keepalive): { path, seconds, sessionId }.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { path?: unknown; seconds?: unknown; sessionId?: unknown };
  try { body = JSON.parse(await req.text()); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  const path = String(body.path ?? '').slice(0, 300);
  const sessionId = (String(body.sessionId ?? '').slice(0, 64)) || null;
  let seconds = Math.round(Number(body.seconds));
  if (!path || !Number.isFinite(seconds) || seconds <= 0) return NextResponse.json({ ok: true });
  seconds = Math.min(seconds, 900); // cap a single flush to 15 min

  try {
    await risansiPool.query(
      `INSERT INTO page_activity (user_email, user_id, role, session_id, path, active_seconds)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.user.email, (session.user.repId as number | null) ?? null, (session.user.role as string | null) ?? null, sessionId, path, seconds],
    );
  } catch (err) {
    console.error('activity beacon failed:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
