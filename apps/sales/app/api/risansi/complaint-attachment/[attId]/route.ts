import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canAccessComplaint } from '@/lib/risansi-auth';

export const runtime = 'nodejs';

// Serve one attachment's bytes, to anyone who can see its complaint.
export async function GET(_req: Request, { params }: { params: Promise<{ attId: string }> }) {
  const { attId } = await params;
  const id = Number(attId);
  if (!Number.isInteger(id)) return new Response('Bad id', { status: 400 });
  const { rows } = await risansiPool.query<{ complaint_id: number; bytes: Buffer; mime_type: string; file_name: string }>(
    'SELECT complaint_id, bytes, mime_type, file_name FROM complaint_attachments WHERE id = $1', [id]);
  const a = rows[0];
  if (!a) return new Response('Not found', { status: 404 });
  const user = await getCurrentUser();
  if (!user.email || !(await canAccessComplaint(user, a.complaint_id))) return new Response('Not found', { status: 404 });
  const inline = /^image\//.test(a.mime_type) || a.mime_type === 'application/pdf';
  return new Response(new Uint8Array(a.bytes), {
    headers: {
      'Content-Type': a.mime_type,
      'Content-Length': String(a.bytes.length),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${a.file_name.replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
