'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { useQuotationDocs, QuotationDocList } from './QuotationDocs';
import { QuotationLinkView } from './QuotationLinkView';
import { parseQuotationLink } from '@/lib/risansi-quotation-link';

// View / add / remove the quotation documents for an opportunity, available at
// any stage from Quoted onward (including a locked Won/Lost — document
// management bypasses the deal lock, like Sales Orders). Uploads and deletes go
// straight to the opportunity's quotation routes; the deal form around it is
// untouched.
export function QuotationPdfManager({ oppId, initialLink, canEdit }: {
  oppId: number;
  initialLink: string | null;
  canEdit: boolean;
}) {
  const { docs, link, loading, loadError, busy, msg, err, upload, remove, refresh } =
    useQuotationDocs(oppId, { initialLink });
  const fileRef = useRef<HTMLInputElement>(null);
  const [clearing, setClearing] = useState(false);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';               // let the user re-pick the same file
    await upload(picked);
  };

  // A quotation recorded before uploads existed has no row in the documents
  // table, so it is shown on its own rather than being lost. It can be one or
  // more SharePoint urls, or just a document name with nothing to open — the
  // shared view knows the difference; this only has to decide when to show it.
  const legacy = parseQuotationLink(link);
  const hasLegacy = !loading && (legacy.kind === 'legacy-link' || legacy.kind === 'legacy-name');
  // Only suppress the document list when there is nothing in it AND a legacy
  // record is standing in for it; an empty list plus a legacy link would
  // otherwise say "No quotation documents attached" directly above the link.
  const externalOnly = hasLegacy && docs.length === 0;

  // Retiring a dead external link. syncQuotationLink refuses to null a non-/api
  // value — that refusal is what stops an upload from destroying it — so this is
  // the deliberate way back, and it replaces what the old Delete button did as a
  // side effect of removing the single PDF.
  const clearLink = async () => {
    if (typeof window !== 'undefined'
      && !window.confirm(legacy.kind === 'legacy-name'
        ? `Remove “${legacy.label}” from this opportunity? It is a document name on record, not a file — nothing else is deleted.`
        : legacy.urls.length > 1
          ? `Remove all ${legacy.urls.length} legacy quotation links from this opportunity? The linked files themselves are not touched.`
          : 'Remove the quotation link from this opportunity? The linked file itself is not touched.')) return;
    setClearing(true);
    try {
      await fetch(`/api/risansi/opportunities/${oppId}/quotation?clearLink=1`, { method: 'DELETE' });
      await refresh();
      window.location.reload();       // the link lives on the server-rendered row
    } finally { setClearing(false); }
  };

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={HEAD}>
        Quotation{docs.length ? ` · ${docs.length} document${docs.length === 1 ? '' : 's'}` : ''}
        {hasLegacy && (docs.length ? ' · legacy link kept' : legacy.kind === 'legacy-name' ? ' · on record' : ' · legacy link')}
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!externalOnly && (
          <QuotationDocList oppId={oppId} docs={docs} loading={loading} busy={busy}
            canEdit={canEdit} onRemove={remove} loadError={loadError}
            fallbackLink={link && link.startsWith('/api/') ? link : undefined}
            emptyText="No quotation documents attached." />
        )}

        {hasLegacy && (
          <div style={{
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
            ...(docs.length ? { paddingTop: 8, borderTop: '1px dashed var(--line)' } : {}),
          }}>
            <QuotationLinkView value={link} label="Open quotation link" />
            {canEdit && (
              <button type="button" onClick={clearLink} disabled={clearing || busy}
                style={{ background: 'none', border: 'none', color: 'var(--neg)', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
                {clearing ? 'Removing…' : legacy.kind === 'legacy-name' ? 'Remove record' : legacy.urls.length > 1 ? 'Remove links' : 'Remove link'}
              </button>
            )}
          </div>
        )}

        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple
              onChange={onPick} style={{ display: 'none' }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} style={BTN}>
              {busy ? 'Working…' : docs.length ? '⤒ Add more PDFs' : '⤒ Upload PDFs'}
            </button>
            <span style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>PDF only · up to 15 MB each · pick several at once</span>
          </div>
        )}

        {msg && <span style={{ fontSize: 11, color: err ? 'var(--neg-strong)' : 'var(--pos-strong)' }}>{msg}</span>}
      </div>
    </div>
  );
}

const HEAD: CSSProperties = {
  padding: '9px 14px', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)',
  fontSize: 12, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const BTN: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit',
};
