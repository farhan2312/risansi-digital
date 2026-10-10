import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

// All active users (id, name, role) — used as the "escalate to" list for
// complaints, which can be assigned to any internal user regardless of tour.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json([], { status: 401 });
  const { rows } = await risansiPool.query(
    `SELECT id::int AS id, name, role FROM users WHERE is_active = TRUE ORDER BY name ASC`,
  );
  return NextResponse.json(rows);
}
