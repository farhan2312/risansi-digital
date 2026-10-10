'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { searchComplaintsToLink, complaintBriefById, type ComplaintBrief } from '@/app/actions/risansi-complaints-v2';

// The "this one repeats that one" picker.
//
// A repeat is logged as its own complaint and pointed at the first one
// (decision 4) rather than reopening it, which means somebody has to find the
// first one by number or by client while looking at the second. A dropdown of
// every complaint ever filed would be unreadable, so this searches: type part
// of a number or a client name, pick from what comes back.
//
// Never forced. The link is offered and can be left empty — a wrong guess at
// which complaint this repeats is worse than no link at all.

export function ComplaintLinkPicker({ value, onChange, disabled, excludeId, inputStyle }: {
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  /** The complaint being edited, so it is never offered as its own original. */
  excludeId?: number | null;
  inputStyle: CSSProperties;
}) {
  const id = value == null || value === '' ? null : Number(value);
  const [linked, setLinked] = useState<ComplaintBrief | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ComplaintBrief[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A stored id should read as its complaint number, not as "#412".
  useEffect(() => {
    if (id == null) { setLinked(null); return; }
    if (linked?.id === id) return;
    let live = true;
    complaintBriefById(id).then(res => {
      if (!live) return;
      if (!res.ok) { setErr(res.error); return; }
      setLinked(res.data);
    }).catch(() => {
      // A refusal comes back as a value; this is the request not arriving.
      if (live) setErr('Could not load the linked complaint. Reload the page to try again.');
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const search = (text: string) => {
    setQ(text); setErr('');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setBusy(true);
      searchComplaintsToLink(text, excludeId ?? null).then(res => {
        setBusy(false);
        if (!res.ok) { setErr(res.error); setHits([]); return; }
        setHits(res.data);
      }).catch(() => {
        // Without this the search spinner stayed on for good: setBusy(false)
        // only ran on the success path, so a dropped request left the box
        // looking like it was still thinking.
        setBusy(false);
        setErr('Search could not reach the server. Try typing again.');
      });
    }, 220);
  };

  const pick = (c: ComplaintBrief) => { setLinked(c); onChange(c.id); setOpen(false); setQ(''); setHits([]); };
  const clear = () => { setLinked(null); onChange(null); setOpen(false); setQ(''); setHits([]); };

  if (id != null && !open) {
    return (
      <div>
        <div style={{ ...inputStyle, height: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600 }}>{linked?.complaint_no ?? `#${id}`}</span>
          {linked?.client_name && <span style={{ fontSize: 11.5, color: 'var(--fg-2)' }}>{linked.client_name}</span>}
          {linked?.complaint_date && <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{linked.complaint_date}</span>}
          {!disabled && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => { setOpen(true); search(''); }} style={MINI}>Change</button>
              <button type="button" onClick={clear} style={MINI}>Clear</button>
            </span>
          )}
        </div>
        {linked == null && !err && <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 3 }}>Linked to a complaint you cannot open.</div>}
        {err && <div style={{ fontSize: 10.5, color: 'var(--neg)', marginTop: 3 }}>{err}</div>}
      </div>
    );
  }

  return (
    <div>
      <input value={q} disabled={disabled} onChange={e => search(e.target.value)} onFocus={() => { if (!hits.length) search(q); }}
        placeholder="Complaint number or client…" style={inputStyle} />
      {err && <div style={{ fontSize: 10.5, color: 'var(--neg)', marginTop: 3 }}>{err}</div>}
      {(busy || hits.length > 0) && (
        <ul style={LIST}>
          {busy && !hits.length && <li style={{ ...ROW, color: 'var(--fg-3)' }}>Looking…</li>}
          {hits.map(c => (
            <li key={c.id}>
              <button type="button" onClick={() => pick(c)} style={{ ...ROW, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg)', font: 'inherit' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 600 }}>{c.complaint_no}</span>
                <span style={{ marginLeft: 8, fontSize: 11.5 }}>{c.client_name ?? 'no client'}</span>
                <span style={{ marginLeft: 8, fontSize: 10.5, color: 'var(--fg-3)' }}>
                  {[c.complaint_date, c.category, c.status].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!busy && !hits.length && q.trim() !== '' && !err && (
        <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 3 }}>No complaint matches &ldquo;{q.trim()}&rdquo;.</div>
      )}
      {id != null && (
        <button type="button" onClick={() => setOpen(false)} style={{ ...MINI, marginTop: 6 }}>Keep the one already linked</button>
      )}
    </div>
  );
}

const MINI: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg-2)',
  borderRadius: 5, fontSize: 10.5, fontWeight: 600, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit',
};
const LIST: CSSProperties = {
  listStyle: 'none', margin: '4px 0 0', padding: 4, maxHeight: 190, overflowY: 'auto',
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6,
};
const ROW: CSSProperties = { display: 'block', padding: '5px 7px', borderRadius: 4, fontSize: 12 };
