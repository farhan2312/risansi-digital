import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';

export async function POST(req: Request) {
  try {
    // /api/** is outside the proxy matcher, so this route must gate itself.
    // Without this it was an open oracle: anyone could POST short guessable codes
    // (LEAD_*, 5-char) and enumerate the client master. Only the admin revenue
    // uploader uses it, so require admin.
    const user = await getCurrentUser();
    if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(user.role, 'admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { codes } = await req.json() as { codes: string[] };

    if (!Array.isArray(codes) || codes.length === 0) {
      return NextResponse.json({ found: {}, notFound: [] });
    }

    // Cap the batch so it can't be turned into a bulk dump.
    const upper = codes.slice(0, 1000).map(c => String(c).toUpperCase());

    const res = await risansiPool.query<{ id: string; code: string; legal_name: string }>(
      `SELECT id::text, UPPER(code) AS code, legal_name
       FROM clients
       WHERE UPPER(code) = ANY($1::text[])
         AND deleted_at IS NULL`,
      [upper],
    );

    const found: Record<string, { id: string; legal_name: string }> = {};
    res.rows.forEach(r => {
      found[r.code] = { id: r.id, legal_name: r.legal_name };
    });

    const notFound = upper.filter(c => !found[c]);

    return NextResponse.json({ found, notFound });
  } catch (err) {
    console.error('[validate-revenue-codes]', err);
    return NextResponse.json({ found: {}, notFound: [] }, { status: 500 });
  }
}
