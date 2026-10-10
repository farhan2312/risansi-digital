import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { buildAdoptionReport } from '@/lib/risansi-adoption-report';

// The portal adoption report, built on demand from live data.
//
// Node runtime: it writes a workbook and rewrites the zip to add chart parts.
export const runtime = 'nodejs';
// Never cached. The point of the button is that the numbers are current.
export const dynamic = 'force-dynamic';

// Admin-only. It names every user and says how little some of them have used the
// application, which is a management conversation rather than a team one.
export async function GET() {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });
  if (!hasRole(user.role, 'admin')) return new NextResponse('Forbidden', { status: 403 });

  try {
    const { buffer } = await buildAdoptionReport(risansiPool);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="user-adoption-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    // Say so in the log rather than handing back a zero-byte file that Excel
    // opens as a corrupt workbook — which is what a silent failure looks like
    // from the other end of a download.
    console.error('[user-adoption report]', e);
    return new NextResponse('Could not build the report', { status: 500 });
  }
}
