import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canViewClient } from '@/lib/risansi-auth';
import { recordAudit } from '@/lib/audit';
import {
  canEditOpp, contentDisposition, loadOpp, listQuotationFiles, syncQuotationLink,
} from '@/lib/risansi-quotation-files';

// Serving bytea needs the Node runtime, not edge.
export const runtime = 'nodejs';

function ids(id: string, fileId: string) {
  const oppId = parseInt(id, 10);
  const docId = parseInt(fileId, 10);
  return Number.isInteger(oppId) && Number.isInteger(docId) ? { oppId, docId } : null;
}

// GET: stream one quotation document inline.
export async function GET(
  _req: Request, { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const parsed = ids(id, fileId);
  if (!parsed) return new NextResponse('Bad id', { status: 400 });
  const { oppId, docId } = parsed;

  const user = await getCurrentUser();
  const opp = await loadOpp(oppId);
  if (!opp) return new NextResponse('Not found', { status: 404 });
  if (!(await canViewClient(user, Number(opp.client_id)))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Scoped by opportunity_id as well as id. Without that second predicate the
  // permission check above would be checking one opportunity while the query
  // returned a document belonging to another — a reader of any single quote
  // could walk document ids and pull every quotation in the company.
  const rec = (await risansiPool.query<{ file_name: string; bytes: Buffer }>(
    'SELECT file_name, bytes FROM opportunity_quotation_files WHERE id = $1 AND opportunity_id = $2',
    [docId, oppId],
  )).rows[0];
  if (!rec) return new NextResponse('Not found', { status: 404 });

  const body = new Uint8Array(rec.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      // Hardcoded, never the stored mime — see the collection route.
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': contentDisposition(rec.file_name),
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}

// DELETE: remove one quotation document, leaving the others alone.
export async function DELETE(
  _req: Request, { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const parsed = ids(id, fileId);
  if (!parsed) return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  const { oppId, docId } = parsed;

  const user = await getCurrentUser();
  if (!user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const opp = await loadOpp(oppId);
  if (!opp) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
  if (!(await canEditOpp(user, opp.rep_id, opp.client_id))) {
    return NextResponse.json({ error: 'You do not have permission to edit this opportunity.' }, { status: 403 });
  }

  const gone = await risansiPool.query<{ file_name: string }>(
    'DELETE FROM opportunity_quotation_files WHERE id = $1 AND opportunity_id = $2 RETURNING file_name',
    [docId, oppId],
  );
  if (gone.rowCount === 0) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

  // Deleting the primary promotes the next-oldest, and deleting the last one
  // clears the link — both handled here so the opportunity never points at a
  // document that is no longer there.
  const link = await syncQuotationLink(oppId);

  await recordAudit({
    action: 'delete', entityType: 'opportunity_quotation_file', entityId: String(docId),
    summary: `Removed quotation document “${gone.rows[0].file_name}” from opportunity #${oppId}`,
    actorEmail: user.email, actorRole: user.role,
  }).catch(() => {});

  return NextResponse.json({ ok: true, link, files: await listQuotationFiles(oppId) });
}
