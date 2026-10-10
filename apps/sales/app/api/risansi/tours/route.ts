import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

// Returns all routes (id, name, zone, rep) ordered by name, for the client
// form's route dropdown and the tour picker on Client 360.
//
// `rep` is the tour's own primary_rep_id resolved to a name. It is shown so
// somebody choosing a tour can see whose route they are putting the client on.
// It is NOT the account's owner: ownership lives on clients.primary_rep_id and
// client_secondary_reps, and mapping a tour does not touch either.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json([], { status: 401 });
    }

    const { rows } = await risansiPool.query(
      `SELECT tr.id::text AS id, tr.name, tr.zone,
              COALESCE(u.name, '') AS rep
         FROM tour_routes tr
         LEFT JOIN users u ON u.id = tr.primary_rep_id AND u.is_active
        ORDER BY tr.name ASC`,
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('Tours API error:', err);
    return NextResponse.json([], { status: 500 });
  }
}
