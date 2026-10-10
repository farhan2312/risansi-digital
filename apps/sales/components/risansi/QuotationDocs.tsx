'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

// The quotation attachment list, shared by the Quotation-details form and the
// Edit-opportunity drawer's PDF panel. Both need the same three behaviours —
// list what is attached, add more, remove one — so they share the hook and the
// list rather than each growing their own copy.

export interface QuotationDoc {
  id: number;
  file_name: string;
  mime: string;
  size: number | null;
  uploaded_at: string;
  uploaded_by_name: string | null;
}

export interface UploadResponse {
  ok?: boolean; error?: string; fileId?: number; fileName?: string;
  link?: string | null; files?: QuotationDoc[];
  meta?: Record<string, string | number | null>;
  items?: Record<string, unknown>[];
}

const MAX_BYTES = 15 * 1024 * 1024;

export function fmtSize(bytes: number | null): string {
  if (!bytes) return '';
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function docHref(oppId: number | string, docId: number): string {
  return `/api/risansi/opportunities/${oppId}/quotation/${docId}`;
}

/**
 * Attachment state for one opportunity.
 *
 * `initialLink` seeds the link the quotation form posts back in its hidden
 * field, so a legacy external url survives until an upload replaces it.
 * `onParsed` is called once per successfully uploaded PDF — the quotation form
 * uses it to fill blank fields, and because that fill only ever touches blanks,
 * attaching several documents lets a later one supply what an earlier one
 * lacked without ever overwriting it.
 */
export function useQuotationDocs(oppId: number | string, opts?: {
  initialLink?: string | null;
  onParsed?: (data: UploadResponse, file: File) => void;
  enabled?: boolean;
}) {
  const enabled = opts?.enabled ?? true;
  const [docs, setDocs]   = useState<QuotationDoc[]>([]);
  const [link, setLink]   = useState<string>(opts?.initialLink ?? '');
  const [loading, setLoading] = useState(enabled);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState('');
  const [err, setErr]     = useState(false);

  // Pull the list from the server. Also used after a failed write, because a
  // request can fail on the way back having already committed — the client then
  // shows nothing attached, and the natural response is to upload it again.
  const refresh = useCallback(async () => {
    try {
      // cache: 'no-store' as well as the server's header. Belt and braces on
      // the one request whose staleness looks exactly like a lost document.
      const r = await fetch(`/api/risansi/opportunities/${oppId}/quotation/files`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { files?: QuotationDoc[] };
      setDocs(d.files ?? []);
      setLoadError(false);
      // A link into this app with no documents behind it is a 404 waiting to
      // happen, and the quotation form posts it back on save. An external url
      // is left alone — it points somewhere this app knows nothing about.
      setLink(cur => (cur.startsWith('/api/') && (d.files ?? []).length === 0 ? '' : cur));
    } catch {
      // Distinguish "nothing attached" from "could not ask": without this the
      // list claims an opportunity has no documents when the request merely failed.
      setLoadError(true);
    }
  }, [oppId]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let alive = true;
    refresh().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [enabled, refresh]);

  // One request per file, in sequence. A single request carrying five PDFs
  // would be one body of their combined size against a 10s function budget,
  // and a failure partway would leave nobody able to say which ones landed.
  const upload = useCallback(async (picked: File[]) => {
    if (!picked.length) return;
    setBusy(true); setMsg(''); setErr(false);

    const failures: string[] = [];
    let added = 0;

    for (let i = 0; i < picked.length; i++) {
      const f = picked[i];
      if (picked.length > 1) setMsg(`Uploading ${i + 1} of ${picked.length}…`);
      if (f.size > MAX_BYTES) { failures.push(`${f.name} — larger than 15 MB`); continue; }
      try {
        const fd = new FormData(); fd.append('file', f);
        const res  = await fetch(`/api/risansi/opportunities/${oppId}/quotation`, { method: 'POST', body: fd });
        // Not every failure comes from the route. A body rejected upstream by
        // the host returns an HTML error page, and parsing that as JSON throws —
        // which would have surfaced a plainly oversize file as "network error".
        const data = (await res.json().catch(() => ({}))) as UploadResponse;
        if (!res.ok) {
          failures.push(`${f.name} — ${data?.error
            || (res.status === 413 ? `too large to upload (${fmtSize(f.size)})` : `upload failed (${res.status})`)}`);
          continue;
        }
        added++;
        if (data.files) setDocs(data.files);
        if (data.link !== undefined) setLink(data.link ?? '');
        opts?.onParsed?.(data, f);
      } catch {
        failures.push(`${f.name} — network error`);
      }
    }

    // Re-read after any failure: the request may have stored the file and died
    // on the way back, and a list that hides it invites a duplicate upload.
    if (failures.length) await refresh();

    setErr(failures.length > 0);
    setMsg([
      added ? `Attached ${added} document${added === 1 ? '' : 's'}.` : '',
      failures.length ? `Could not attach: ${failures.join('; ')}` : '',
    ].filter(Boolean).join(' '));
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppId, refresh, opts?.onParsed]);

  const remove = useCallback(async (docId: number, name: string) => {
    if (typeof window !== 'undefined' && !window.confirm(`Remove “${name}” from this quotation?`)) return;
    setBusy(true); setMsg(''); setErr(false);
    try {
      const res  = await fetch(docHref(oppId, docId), { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as UploadResponse;
      if (res.status === 404) {
        // Already gone — another tab, another user, or a double click. Reflect
        // that instead of leaving a dead row whose Remove button only re-errors.
        await refresh();
        setMsg(`“${name}” was already removed.`);
        return;
      }
      if (!res.ok) throw new Error(data?.error || 'Delete failed');
      setDocs(data.files ?? []);
      setLink(data.link ?? '');
      setMsg(`Removed “${name}”.`);
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : 'Delete failed.');
      await refresh();
    } finally { setBusy(false); }
  }, [oppId, refresh]);

  return { docs, link, loading, loadError, busy, msg, err, upload, remove, refresh, setMsg };
}

// ── The list itself ───────────────────────────────────────────────

export function QuotationDocList({ oppId, docs, loading, busy, canEdit, onRemove, emptyText, loadError, fallbackLink }: {
  oppId: number | string;
  docs: QuotationDoc[];
  loading: boolean;
  busy: boolean;
  canEdit: boolean;
  onRemove: (id: number, name: string) => void;
  emptyText?: string;
  loadError?: boolean;
  fallbackLink?: string;
}) {
  if (loading) return <span style={MUTED}>Loading documents…</span>;

  // The list failing to load is not the same as there being nothing attached,
  // and saying the wrong one invites someone to re-upload what is already there.
  if (loadError && !docs.length) {
    return (
      <span style={{ ...MUTED, color: 'var(--warn-strong, #92400E)' }}>
        Couldn’t load the document list.{' '}
        {fallbackLink
          ? <a href={fallbackLink} target="_blank" rel="noreferrer" style={{ color: 'var(--title)' }}>Open the quotation directly</a>
          : 'Reopen this card to try again.'}
      </span>
    );
  }
  if (!docs.length) return <span style={MUTED}>{emptyText ?? 'No documents attached.'}</span>;

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {docs.map((d, i) => (
        <li key={d.id} style={ROW}>
          <a href={docHref(oppId, d.id)} target="_blank" rel="noreferrer" style={NAME} title={d.file_name}>
            📄 {d.file_name}
          </a>
          {/* The first document is what quotation_link resolves to, so anyone
              reading the row in Excel or on Client 360 lands on this one. */}
          {i === 0 && docs.length > 1 && <span style={TAG}>primary</span>}
          <span style={META}>
            {[fmtSize(d.size), d.uploaded_at?.slice(0, 10), d.uploaded_by_name].filter(Boolean).join(' · ')}
          </span>
          {canEdit && (
            <button type="button" onClick={() => onRemove(d.id, d.file_name)} disabled={busy}
              aria-label={`Remove ${d.file_name}`} style={REMOVE}>
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

const MUTED: CSSProperties = { fontSize: 12, color: 'var(--fg-3)' };
const ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  padding: '5px 8px', borderRadius: 6, background: 'var(--bg-elev)', border: '1px solid var(--line)',
};
const NAME: CSSProperties = {
  fontSize: 12.5, fontWeight: 600, color: 'var(--title)', textDecoration: 'none',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260,
};
const TAG: CSSProperties = {
  fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
  color: 'var(--fg-3)', border: '1px solid var(--line-strong)', borderRadius: 4, padding: '1px 5px',
};
const META: CSSProperties = { fontSize: 10.5, color: 'var(--fg-3)', marginLeft: 'auto' };
const REMOVE: CSSProperties = {
  background: 'none', border: 'none', color: 'var(--neg)', cursor: 'pointer',
  fontSize: 11, fontWeight: 600, fontFamily: 'inherit', padding: '2px 4px',
};
