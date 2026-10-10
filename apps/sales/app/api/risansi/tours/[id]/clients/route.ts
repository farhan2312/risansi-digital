import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

// Clients belonging to a single tour. Loaded on demand when the sysadmin
// expands a tour card on the Tours tab, so the hub stays light. Sysadmin only.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'sysadmin') {
    return NextResponse.json({ error: 'Sysadmin access required' }, { status: 403 });
  }

  const { id } = await params;
  const tourId = Number(id);
  if (!Number.isInteger(tourId) || tourId <= 0) {
    return NextResponse.json({ error: 'Bad tour id' }, { status: 400 });
  }

  const { rows } = await risansiPool.query(
    `SELECT id::int AS id, code, legal_name, industry, zone, status
       FROM clients
      WHERE tour_id = $1 AND deleted_at IS NULL
      ORDER BY legal_name ASC`,
    [tourId],
  );
  return NextResponse.json(rows);
}
