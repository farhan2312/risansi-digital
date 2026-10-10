import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole, canViewClient, isDepartment, type RisansiRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';

// Every column the board renders. 'On Hold' was missing here while the board
// showed the column, so every drag into On Hold came back 400 "Invalid stage"
// and the card snapped straight back — for everyone, admins included.
const VALID = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped'];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { stage } = await req.json();

  if (!VALID.includes(stage)) {
    return NextResponse.json({ error: 'Invalid stage' }, { status: 400 });
  }

  // Ownership. This MUST match two other things or the board lies to the user:
  // the CAN_EDIT_CASE that decides whether a card is draggable at all, and
  // userCanEditOpp, which guards the same move made through the Edit drawer.
  // Both follow the client — you can edit the opportunities of clients you
  // tour(s), or granted to you directly. This route used to check only
  // `o.rep_id = you`, which is far narrower: 984 opportunities across 11 reps
  // and managers were draggable in the UI and 403'd by the server, so the card
  // just sprang back with no explanation.
  const oppRes = await risansiPool.query<{ rep_id: number | null; stage: string; client_id: number | null }>(
    'SELECT rep_id, stage, client_id FROM opportunities WHERE id = $1', [id],
  );
  if (!oppRes.rows[0]) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // Gate: Quoted is a mandatory gateway — Negotiating / Won / Lost require the
  // card to have been Quoted, so it can never skip straight to Won/Lost.
  if (['Negotiating', 'Won', 'Lost'].includes(stage)
      && !['Quoted', 'Negotiating', 'Won', 'Lost'].includes(oppRes.rows[0].stage)) {
    return NextResponse.json(
      { error: 'Move this opportunity through Quoted first.' },
      { status: 422 },
    );
  }
  const oppRepId  = oppRes.rows[0].rep_id;
  const clientId  = oppRes.rows[0].client_id;
  const role      = session.user.role;
  const repId     = session.user.repId ?? null;
  let allowed = hasRole(role, 'admin');
  if (!allowed && repId != null && oppRepId != null && Number(oppRepId) === Number(repId)) {
    allowed = true;
  }
  if (!allowed && clientId != null) {
    allowed = await canViewClient(
      { id: repId, email: session.user.email ?? null, role: role as RisansiRole,
        departments: (session.user.departments ?? []).filter(isDepartment) },
      Number(clientId),
    );
  }
  if (!allowed) {
    return NextResponse.json(
      { error: 'You do not have permission to move this opportunity.' },
      { status: 403 },
    );
  }

  try {
    await risansiPool.query(
      `UPDATE opportunities SET stage = $1, updated_at = NOW() WHERE id = $2`,
      [stage, id],
    );
    // from_stage was hardcoded NULL here, which threw away the only thing that
    // makes a transition a transition — and the whole INSERT was swallowed
    // because the table didn't exist (migration 0042). Both fixed: the previous
    // stage is already in hand from the ownership check above, and a failure now
    // gets logged instead of vanishing.
    try {
      await risansiPool.query(
        `INSERT INTO opportunity_stage_log (opportunity_id, from_stage, to_stage, notes, changed_by)
         VALUES ($1, $2, $3, 'Drag-and-drop on Opportunities board', $4)`,
        [id, oppRes.rows[0].stage, stage, session.user.email],
      );
    } catch (logErr) {
      // Never fail the move over its audit row — but say so.
      console.error('opportunity_stage_log insert failed:', logErr);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Stage update error:', err);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
