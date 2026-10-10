import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { clientRepIdsSql } from '@/lib/risansi-client-rep';

// Returns the current owner user ids for a client, from client_assignments.
//   GET /api/risansi/client-owners?clientId=123  →  { owner_ids: [1, 4, 9] }
// Used by the client form to prefill the multi-owner picker when editing.
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ owner_ids: [] }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const clientId = parseInt(searchParams.get('clientId') ?? '', 10);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return NextResponse.json({ owner_ids: [] });
    }

    const { rows } = await risansiPool.query<{ user_id: number }>(
      `SELECT user_id FROM (${clientRepIdsSql('$1')}) r ORDER BY r.rank, r.ord NULLS FIRST`,
      [clientId],
    );
    return NextResponse.json({ owner_ids: rows.map(r => r.user_id) });
  } catch (err) {
    console.error('Client-owners API error:', err);
    return NextResponse.json({ owner_ids: [] }, { status: 500 });
  }
}
