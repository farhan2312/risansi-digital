import risansiPool from '@/lib/db-risansi';
import { checkCardPhoto } from '@/lib/risansi-exhibition-files';
import { guardMeeting } from '@/lib/risansi-meeting-cards';

export const runtime = 'nodejs';

/**
 * Business cards photographed at an exhibition meeting.
 *
 * One card per request, like the quotation documents: several photos in a single
 * multipart body would be one request carrying their combined size against a
 * 10s function budget, and a failure halfway would leave the rep unable to tell
 * which ones landed. The client loops instead.
 */

export async function GET(_req: Request, ctx: { params: Promise<{ meetingId: string }> }) {
  const { meetingId: raw } = await ctx.params;
  const meetingId = Number(raw);
  if (!Number.isInteger(meetingId)) return Response.json({ error: 'Bad request' }, { status: 400 });

  const g = await guardMeeting(meetingId);
  if (!g.ok) return Response.json({ error: 'Not allowed' }, { status: g.status });

  // Metadata only — the bytes come one at a time from the per-card route, so
  // listing a meeting with four cards stays a few hundred bytes.
  const { rows } = await risansiPool.query(
    `SELECT id, file_name, mime_type, byte_size,
            uploaded_at::text AS uploaded_at, uploaded_by_name
       FROM exhibition_meeting_cards
      WHERE meeting_id = $1
      ORDER BY uploaded_at, id`, [meetingId],
  );
  return Response.json({ cards: rows });
}

export async function POST(request: Request, ctx: { params: Promise<{ meetingId: string }> }) {
  const { meetingId: raw } = await ctx.params;
  const meetingId = Number(raw);
  if (!Number.isInteger(meetingId)) return Response.json({ error: 'Bad request' }, { status: 400 });

  const g = await guardMeeting(meetingId);
  if (!g.ok) return Response.json({ error: 'Not allowed' }, { status: g.status });

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'No photo supplied.' }, { status: 400 });

    const buf   = Buffer.from(await file.arrayBuffer());
    const check = checkCardPhoto(file.name || 'card.jpg', file.type || '', file.size, new Uint8Array(buf.subarray(0, 8)));
    if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

    const { rows } = await risansiPool.query<{ id: number }>(
      `INSERT INTO exhibition_meeting_cards
         (meeting_id, file_name, mime_type, byte_size, bytes, uploaded_by, uploaded_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,(SELECT name FROM users WHERE id = $6))
       RETURNING id`,
      [meetingId, (file.name || 'card.jpg').slice(0, 200), check.mime!, file.size, buf, g.user.id],
    );

    const { rows: cards } = await risansiPool.query(
      `SELECT id, file_name, mime_type, byte_size,
              uploaded_at::text AS uploaded_at, uploaded_by_name
         FROM exhibition_meeting_cards WHERE meeting_id = $1 ORDER BY uploaded_at, id`,
      [meetingId],
    );
    return Response.json({ ok: true, id: rows[0].id, file_name: file.name, cards });
  } catch (err) {
    console.error('[meeting-card] upload', err);
    return Response.json({ error: 'Could not save that photo.' }, { status: 500 });
  }
}
