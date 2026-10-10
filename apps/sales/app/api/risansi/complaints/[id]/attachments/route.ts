import { NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canAccessComplaint, hasRole } from '@/lib/risansi-auth';
import { recordAudit } from '@/lib/audit';
import { canEditPage, pageById } from '@/lib/risansi-complaint-flow';

export const runtime = 'nodejs';

// A complaint arrives as a photo or a clip of the pump running far more often
// than as a document, and video was refused until now — a TSM filming a leak on
// a phone got "unsupported file type" at the moment the evidence was in hand.
// quicktime is what an iPhone records, 3gpp what a cheaper Android does.
const MAX_BYTES = 20_000_000;
// Video gets its own ceiling. These are stored as bytea in Postgres, so the
// limit is about what the row and the pool can carry, not about the format: a
// few seconds of phone video clears 20 MB easily, and a whole site walkthrough
// does not belong in a complaint record either way.
const MAX_VIDEO_BYTES = 60_000_000;
const CATEGORIES = new Set(['complaint', 'photo', 'capa', 'customer', 'other']);
const IS_VIDEO = /^video\//;
const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm|3gpp|x-matroska|x-msvideo)|application\/pdf|application\/vnd\.(ms-excel|openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document))|application\/msword|text\/plain|message\/rfc822)$/;

// Upload one file to a complaint: multipart with `file`, `category`, optional `caption`.
//
// The CAPA report goes here as category 'capa' — that is the closure gate for
// an S1 or S2 complaint, so who may attach it follows page 6's edit rule; the
// rest follow page 1's. Files are bytes in the row, like the photos before
// them, because the portal has no blob store and 20 MB of PDF in Postgres is
// fine at this volume.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const cid = Number(id);
    if (!Number.isInteger(cid)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

    const user = await getCurrentUser();
    if (!user.email || !(await canAccessComplaint(user, cid))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const form = await req.formData();
    const file = form.get('file');
    const category = String(form.get('category') ?? 'other');
    const caption = ((form.get('caption') as string | null) ?? '').slice(0, 500) || null;
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!CATEGORIES.has(category)) return NextResponse.json({ error: 'Unknown category' }, { status: 400 });

    const { rows: [c] } = await risansiPool.query<{
      status: string; schema_version: number; complaint_type: string | null; investigation_assigned_to: number | null;
      action_assigned_to: number | null; returnable_owner: number | null; rep_user_id: number | null; reported_by_user: number | null;
    }>(`SELECT status, schema_version, complaint_type, investigation_assigned_to, action_assigned_to, returnable_owner, rep_user_id, reported_by_user
          FROM complaints WHERE id = $1`, [cid]);
    if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const page = pageById(category === 'capa' ? 6 : 1)!;
    const may = hasRole(user.role, 'admin')
      || canEditPage({ id: user.id, role: user.role, departments: user.departments }, { ...c, worksClient: true }, page);
    if (!may) return NextResponse.json({ error: `Only somebody who can edit ${page.title} can attach files here.` }, { status: 403 });

    const mime = file.type || 'application/octet-stream';
    if (!ALLOWED.test(mime)) return NextResponse.json({ error: `Unsupported file type (${mime}). Images, video, PDF, Word, Excel or text.` }, { status: 415 });
    const buf = Buffer.from(await file.arrayBuffer());
    if (!buf.length) return NextResponse.json({ error: 'Empty file' }, { status: 400 });
    const cap = IS_VIDEO.test(mime) ? MAX_VIDEO_BYTES : MAX_BYTES;
    if (buf.length > cap) {
      return NextResponse.json(
        { error: `File too large (max ${Math.round(cap / 1_000_000)} MB${IS_VIDEO.test(mime) ? ' for video' : ''})` },
        { status: 413 },
      );
    }

    const { rows } = await risansiPool.query(
      `INSERT INTO complaint_attachments (complaint_id, category, file_name, mime_type, byte_size, bytes, caption, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, category, file_name, mime_type, byte_size, caption, uploaded_by, uploaded_at::text AS uploaded_at`,
      [cid, category, (file.name || 'file').slice(0, 200), mime, buf.length, buf, caption, user.email]);
    await recordAudit({ action: 'create', entityType: 'complaint', entityId: cid,
      summary: `Attached ${category === 'capa' ? 'the CAPA document' : `a ${category} file`}: ${file.name}`, actorEmail: user.email, actorRole: user.role });
    return NextResponse.json({ attachment: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('Complaint attachment upload error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
