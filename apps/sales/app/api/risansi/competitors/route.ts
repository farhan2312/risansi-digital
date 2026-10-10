import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';

// The competitor master list, for the pickers on Competition and the visit form.
//
// Not client data, so there is nothing here to scope per user — but it is still
// an internal list of who the company tracks, and it answered anyone who knew
// the URL. getCurrentUser resolves a revoked or signed-out session to SIGNED_OUT
// with a null email, so the check below covers withdrawal as well as sign-out.
export async function GET() {
  const user = await getCurrentUser();
  if (!user.email) return NextResponse.json([], { status: 401 });

  try {
    const res = await risansiPool.query(
      `SELECT id, name FROM competitors WHERE is_active = TRUE ORDER BY name ASC`,
    );
    return NextResponse.json(res.rows);
  } catch {
    // is_active column may not exist — fall back to the full list
    try {
      const res = await risansiPool.query(
        `SELECT id, name FROM competitors ORDER BY name ASC`,
      );
      return NextResponse.json(res.rows);
    } catch {
      return NextResponse.json([], { status: 500 });
    }
  }
}
