import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canViewClient } from '@/lib/risansi-auth';
import { parseQuotationText } from '@/lib/risansi-quotation-parser';
import {
  canEditOpp, clearQuotationLink, contentDisposition, loadOpp, listQuotationFiles,
  pdfRejectionReason, syncQuotationLink,
} from '@/lib/risansi-quotation-files';

// unpdf (and its bundled pdf.js) needs the Node runtime, not edge.
export const runtime = 'nodejs';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

// POST: attach ANOTHER quotation document and return best-effort parsed fields.
//
// One document per request, deliberately. Several PDFs in a single multipart
// body would be one request carrying the sum of their sizes, against a platform
// that caps both the request body and (vercel.json) this function at 10s — and
// a failure halfway through would leave the user unable to tell which files
// landed. The client loops instead, so each file succeeds or fails on its own.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const oppId = parseInt(id, 10);
  if (!Number.isInteger(oppId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const user = await getCurrentUser();
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const opp = await loadOpp(oppId);
  if (!opp) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
  if (!(await canEditOpp(user, opp.rep_id, opp.client_id))) {
    return NextResponse.json({ error: 'You do not have permission to edit this opportunity.' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }
  const fileName = (file instanceof File && file.name) ? file.name : 'quotation.pdf';
  const mime = file.type || 'application/pdf';
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File is too large (max 15 MB).' }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const rejection = pdfRejectionReason(bytes, fileName, mime);
  if (rejection) return NextResponse.json({ error: rejection }, { status: 415 });

  // Parse best-effort — never let extraction failure block storing the file.
  let parsed: ReturnType<typeof parseQuotationText> = { meta: {}, items: [] };
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    parsed = parseQuotationText(Array.isArray(text) ? text.join('\n') : text);
  } catch {
    // Scanned / unreadable PDF — store it, return empty fields.
  }

  // Append. This used to be an upsert keyed on opportunity_id, which is exactly
  // what limited a quote to a single document: uploading a second one silently
  // overwrote the first.
  const { rows } = await risansiPool.query<{ id: number }>(
    `INSERT INTO opportunity_quotation_files
       (opportunity_id, file_name, mime, size, bytes, uploaded_at, uploaded_by, uploaded_by_name)
     VALUES ($1, $2, $3, $4, $5, now(), $6, (SELECT name FROM users WHERE id = $6))
     RETURNING id`,
    [oppId, fileName, mime, file.size, bytes, user.id ?? null],
  );
  const fileId = rows[0].id;

  const link = await syncQuotationLink(oppId);
  const files = await listQuotationFiles(oppId);

  return NextResponse.json({
    ok: true, fileId, fileName, size: file.size,
    // The collection link, not the per-file one: it is what quotation_link
    // stores and what the Excel export and Client 360 already render.
    link, files, meta: parsed.meta, items: parsed.items,
  });
}

// DELETE: remove EVERY quotation document for this opportunity.
//
// Kept alongside the per-document delete because a browser still running the
// pre-multi-document bundle calls this one, and to that user there is exactly
// one PDF — so removing the set is what they asked for.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const oppId = parseInt(id, 10);
  if (!Number.isInteger(oppId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const user = await getCurrentUser();
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const opp = await loadOpp(oppId);
  if (!opp) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
  if (!(await canEditOpp(user, opp.rep_id, opp.client_id))) {
    return NextResponse.json({ error: 'You do not have permission to edit this opportunity.' }, { status: 403 });
  }

  await risansiPool.query('DELETE FROM opportunity_quotation_files WHERE opportunity_id = $1', [oppId]);

  // ?clearLink=1 also drops a legacy external url. syncQuotationLink deliberately
  // refuses to, so this is the one way to retire a dead link — the capability the
  // old single-file Delete button had, now something you ask for rather than a
  // side effect of removing a document.
  const clear = new URL(req.url).searchParams.get('clearLink') === '1';
  if (clear) await clearQuotationLink(oppId);
  const link = clear ? null : await syncQuotationLink(oppId);
  return NextResponse.json({ ok: true, link, files: [] });
}

// GET: stream the PRIMARY document (the first one attached) inline.
//
// This endpoint is what opportunities.quotation_link holds for 196 existing
// rows, and those links have been exported to Excel and shared. It therefore
// has to keep answering with a PDF rather than becoming a JSON listing — the
// listing lives at /quotation/files, and individual documents at /quotation/<id>.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const oppId = parseInt(id, 10);
  if (!Number.isInteger(oppId)) return new NextResponse('Bad id', { status: 400 });

  const user = await getCurrentUser();
  const opp = await loadOpp(oppId);
  if (!opp) return new NextResponse('Not found', { status: 404 });
  if (!(await canViewClient(user, Number(opp.client_id)))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const rec = (await risansiPool.query<{ file_name: string; bytes: Buffer }>(
    `SELECT file_name, bytes FROM opportunity_quotation_files
      WHERE opportunity_id = $1 ORDER BY uploaded_at, id LIMIT 1`, [oppId],
  )).rows[0];
  if (!rec) return new NextResponse('No file', { status: 404 });

  const body = new Uint8Array(rec.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      // Hardcode application/pdf and forbid MIME-sniffing rather than echoing the
      // stored mime — even if a bad row predates the upload hardening above, the
      // browser will never execute it as HTML/SVG.
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': contentDisposition(rec.file_name),
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
