import risansiPool from '@/lib/db-risansi';
import { SERVEABLE_TYPES } from '@/lib/risansi-exhibition-files';
import { guardMeeting } from '@/lib/risansi-meeting-cards';

export const runtime = 'nodejs';

// Destructured by name. Reading them positionally out of the params object
// would depend on key order, which nothing guarantees.
function ids(params: { meetingId: string; cardId: string }) {
  const m = Number(params.meetingId), c = Number(params.cardId);
  return Number.isInteger(m) && Number.isInteger(c) ? { m, c } : null;
}

/** Stream one card image. */
export async function GET(_req: Request, ctx: { params: Promise<{ meetingId: string; cardId: string }> }) {
  const p = ids(await ctx.params);
  if (!p) return new Response('Bad request', { status: 400 });

  const g = await guardMeeting(p.m);
  if (!g.ok) return new Response('Not allowed', { status: g.status });

  // Scoped by meeting_id as well as id: without it the permission check above
  // would be guarding one meeting while the query returned another's card, and
  // anyone able to see a single meeting could walk ids across the whole module.
  const { rows } = await risansiPool.query<{ bytes: Buffer; mime_type: string; file_name: string }>(
    'SELECT bytes, mime_type, file_name FROM exhibition_meeting_cards WHERE id = $1 AND meeting_id = $2',
    [p.c, p.m],
  );
  const card = rows[0];
  if (!card) return new Response('Not found', { status: 404 });

  // Never echo the stored mime — a row predating the upload checks must not be
  // able to make us serve something executable.
  const type = SERVEABLE_TYPES.includes(card.mime_type) ? card.mime_type : 'image/jpeg';
  const body = new Uint8Array(card.bytes);
  return new Response(body, {
    headers: {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, max-age=86400',
    },
  });
}

/** Remove one card. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ meetingId: string; cardId: string }> }) {
  const p = ids(await ctx.params);
  if (!p) return Response.json({ error: 'Bad request' }, { status: 400 });

  const g = await guardMeeting(p.m);
  if (!g.ok) return Response.json({ error: 'Not allowed' }, { status: g.status });

  const gone = await risansiPool.query(
    'DELETE FROM exhibition_meeting_cards WHERE id = $1 AND meeting_id = $2', [p.c, p.m],
  );
  if (gone.rowCount === 0) return Response.json({ error: 'Card not found' }, { status: 404 });

  const { rows: cards } = await risansiPool.query(
    `SELECT id, file_name, mime_type, byte_size,
            uploaded_at::text AS uploaded_at, uploaded_by_name
       FROM exhibition_meeting_cards WHERE meeting_id = $1 ORDER BY uploaded_at, id`,
    [p.m],
  );
  return Response.json({ ok: true, cards });
}
