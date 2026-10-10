import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getManagerAssignableReps } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';

// Columns every consumer of this endpoint relies on. id is text so client-side
// String(id) comparisons stay stable.
const REP_COLS = `id::text AS id, name, zone, route, initials, rep_code, email, role`;

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json([], { status: 401 });
    }

    const role  = session.user.role;
    const repId = session.user.repId;

    // Admin / Sysadmin → all active users.
    if (['admin', 'sysadmin'].includes(role)) {
      const { rows } = await risansiPool.query(
        `SELECT ${REP_COLS} FROM users WHERE is_active = TRUE ORDER BY name ASC`,
      );
      return NextResponse.json(rows);
    }

    // Manager → users in their assigned tours, including themselves (sorted first).
    if (role === 'manager' && repId) {
      const assignableIds = await getManagerAssignableReps(repId);

      if (assignableIds.length === 0) {
        const { rows } = await risansiPool.query(
          `SELECT ${REP_COLS} FROM users WHERE id = $1`,
          [repId],
        );
        return NextResponse.json(rows);
      }

      const { rows } = await risansiPool.query(
        `SELECT ${REP_COLS}
           FROM users
          WHERE id = ANY($1::int[])
            AND is_active = TRUE
          ORDER BY CASE WHEN id = $2 THEN 0 ELSE 1 END, name ASC`,
        [assignableIds, repId],
      );
      return NextResponse.json(rows);
    }

    // Rep → only themselves.
    if (role === 'rep' && repId) {
      const { rows } = await risansiPool.query(
        `SELECT ${REP_COLS} FROM users WHERE id = $1`,
        [repId],
      );
      return NextResponse.json(rows);
    }

    // Authenticated but not linked to a rep (e.g. unlinked rep/manager) → empty.
    return NextResponse.json([]);
  } catch (err) {
    console.error('Reps API error:', err);
    return NextResponse.json([], { status: 500 });
  }
}
