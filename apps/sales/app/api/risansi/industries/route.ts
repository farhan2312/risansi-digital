import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';

// Distinct industry names, for the datalist on the client form.
//
// Deliberately NOT scoped to the caller's clients even though it reads from the
// clients table. This feeds a suggestion list on a form where the answer is
// frequently an industry the user has never worked — scoping it would offer a
// rep a shorter list than the one they need and quietly push them into typing a
// near-duplicate, which is how an industry column ends up with four spellings of
// the same word. The values themselves are generic ("Sugar", "Paper"); no client
// is identifiable from them.
//
// It does need a caller, though, which it did not have: it answered anyone who
// knew the URL.
export async function GET() {
  const user = await getCurrentUser();
  if (!user.email) return NextResponse.json([], { status: 401 });

  try {
    const res = await risansiPool.query(`
      SELECT DISTINCT industry
      FROM clients
      WHERE industry IS NOT NULL
        AND industry != ''
        AND deleted_at IS NULL
      ORDER BY industry ASC
    `);
    const industries = res.rows.map((r: { industry: string }) => r.industry);
    return NextResponse.json(industries);
  } catch (err) {
    console.error('Industries API error:', err);
    return NextResponse.json([], { status: 500 });
  }
}
