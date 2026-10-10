import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { canManageExhibition } from '@/app/actions/risansi-exhibitions';
import { checkInvoice, SERVEABLE_TYPES } from '@/lib/risansi-exhibition-files';

/**
 * Invoice attached to an exhibition expense line.
 *
 * Modelled on the opportunity quotation route, including its file-type checks —
 * those are security fixes, not boilerplate. An upload must satisfy ALL of:
 * declared mime, file extension, and the leading magic bytes. Checking only the
 * mime or only the name lets a file called invoice.pdf carrying HTML through, and
 * a stored page that executes in a colleague's browser is stored XSS.
 *
 * GET hardcodes the Content-Type rather than echoing what was stored, and sends
 * nosniff, so even a bad row can never be served as something executable.
 */



/** Resolve the expense's parent exhibition, then defer to the module's own
 *  permission rule. An expense id alone must never be enough. */
async function guard(expenseId: number) {
  const { rows } = await risansiPool.query<{ exhibition_id: number }>(
    'SELECT exhibition_id FROM exhibition_expenses WHERE id = $1', [expenseId],
  );
  const exhibitionId = rows[0]?.exhibition_id;
  if (!exhibitionId) return { ok: false as const, status: 404 };
  const user = await getCurrentUser();
  if (!user.email) return { ok: false as const, status: 401 };
  if (!(await canManageExhibition(exhibitionId))) return { ok: false as const, status: 403 };
  return { ok: true as const, exhibitionId, user };
}

export async function POST(request: Request, ctx: { params: Promise<{ expenseId: string }> }) {
  const { expenseId: raw } = await ctx.params;
  const expenseId = Number(raw);
  if (!Number.isInteger(expenseId)) return Response.json({ error: 'Bad request' }, { status: 400 });

  const g = await guard(expenseId);
  if (!g.ok) return Response.json({ error: 'Not allowed' }, { status: g.status });

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'No file supplied.' }, { status: 400 });
    const buf   = Buffer.from(await file.arrayBuffer());
    const check = checkInvoice(file.name, file.type || '', file.size, new Uint8Array(buf.subarray(0, 8)));
    if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

    await risansiPool.query(
      `INSERT INTO exhibition_expense_files (expense_id, file_name, mime_type, bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (expense_id) DO UPDATE
         SET file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type,
             bytes = EXCLUDED.bytes, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = NOW()`,
      [expenseId, file.name.slice(0, 200), check.mime!, buf, g.user.id],
    );
    return Response.json({ ok: true, file_name: file.name });
  } catch (err) {
    console.error('[exhibition invoice upload]', err);
    return Response.json({ error: 'Upload failed.' }, { status: 500 });
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ expenseId: string }> }) {
  const { expenseId: raw } = await ctx.params;
  const expenseId = Number(raw);
  if (!Number.isInteger(expenseId)) return new Response('Bad request', { status: 400 });

  const g = await guard(expenseId);
  if (!g.ok) return new Response('Not allowed', { status: g.status });

  const { rows } = await risansiPool.query<{ file_name: string; mime_type: string; bytes: Buffer }>(
    'SELECT file_name, mime_type, bytes FROM exhibition_expense_files WHERE expense_id = $1', [expenseId],
  );
  const rec = rows[0];
  if (!rec) return new Response('Not found', { status: 404 });

  // Serve only from the fixed allow-list; never echo the stored value.
  const safeType = SERVEABLE_TYPES.includes(rec.mime_type) ? rec.mime_type : 'application/octet-stream';

  return new Response(new Uint8Array(rec.bytes), {
    headers: {
      'Content-Type': safeType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${rec.file_name.replace(/[^\w.\-]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ expenseId: string }> }) {
  const { expenseId: raw } = await ctx.params;
  const expenseId = Number(raw);
  if (!Number.isInteger(expenseId)) return Response.json({ error: 'Bad request' }, { status: 400 });

  const g = await guard(expenseId);
  if (!g.ok) return Response.json({ error: 'Not allowed' }, { status: g.status });

  await risansiPool.query('DELETE FROM exhibition_expense_files WHERE expense_id = $1', [expenseId]);
  return Response.json({ ok: true });
}
