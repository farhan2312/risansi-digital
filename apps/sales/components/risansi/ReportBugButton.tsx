'use client';

import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { BUG_SEVERITIES, BUG_SEVERITY_LABELS, BUG_TYPES, BUG_TYPE_LABELS, BUG_TYPE_COLORS, type BugSeverity, type BugType } from '@/lib/risansi-bugs';

// Matches MAX_SHOTS in app/api/risansi/bugs/route.ts — the form stops the
// reporter here so they find out before the upload rather than after it.
const MAX_SHOTS = 10;
const MAX_SHOT_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp)$/i;

// "Report a Bug" — any signed-in user describes an issue, attaches as many
// screenshots as the problem takes to show, and files it. Posts multipart to
// /api/risansi/bugs; the system admin then works it through the pipeline on
// /risansi/admin/bugs.
export function ReportBugButton() {
  const [open, setOpen]           = useState(false);
  const [title, setTitle]         = useState('');
  const [description, setDesc]    = useState('');
  const [type, setType]           = useState<BugType>('bug');
  const [severity, setSeverity]   = useState<BugSeverity>('medium');
  const [pageUrl, setPageUrl]     = useState('');
  const [files, setFiles]         = useState<File[]>([]);
  const [previews, setPreviews]   = useState<string[]>([]);
  const [submitting, setSubmit]   = useState(false);
  const [error, setError]         = useState('');
  const [done, setDone]           = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Prefill the page the user is on when they open the dialog.
  useEffect(() => {
    if (open && !pageUrl) setPageUrl(window.location.pathname + window.location.search);
  }, [open, pageUrl]);

  // One object URL per attached image, revoked as a set whenever the list
  // changes so removing a thumbnail does not leak the blob behind it.
  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);

  const reset = () => {
    setTitle(''); setDesc(''); setType('bug'); setSeverity('medium'); setPageUrl('');
    setFiles([]); setError(''); setDone(false); setSubmit(false);
    if (fileRef.current) fileRef.current.value = '';
  };
  const close = () => { setOpen(false); reset(); };

  // Add to what is already attached rather than replacing it, so a reporter can
  // pick a couple from disk, then paste another, and keep the lot.
  const addFiles = (picked: File[]) => {
    setError('');
    if (!picked.length) return;
    const bad = picked.find(f => !IMAGE_TYPES.test(f.type));
    if (bad) { setError('Screenshots must be PNG, JPG, GIF, WebP or BMP images.'); return; }
    const big = picked.find(f => f.size > MAX_SHOT_BYTES);
    if (big) { setError(`“${big.name}” is too large (max 8 MB each).`); return; }
    const room = MAX_SHOTS - files.length;
    if (room <= 0) { setError(`You can attach at most ${MAX_SHOTS} screenshots.`); return; }
    if (picked.length > room) setError(`Only the first ${room} were added — the limit is ${MAX_SHOTS} screenshots.`);
    setFiles(prev => [...prev, ...picked.slice(0, MAX_SHOTS - prev.length)]);
  };

  const removeFile = (i: number) => {
    setError('');
    setFiles(prev => prev.filter((_, n) => n !== i));
  };

  // Ctrl+V of a screen capture, which is how most of these arrive. The clipboard
  // names a pasted image "image.png" or nothing at all, so give it a name that
  // tells the admin where it came from.
  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData?.files ?? []).filter(f => IMAGE_TYPES.test(f.type));
    if (!pasted.length) return;
    e.preventDefault();
    const stamp = Date.now();
    addFiles(pasted.map((f, i) => (
      f.name && f.name !== 'image.png' ? f
        : new File([f], `pasted-${stamp}-${i + 1}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })
    )));
  };

  const submit = async () => {
    if (!title.trim()) { setError('Please add a short title.'); return; }
    setSubmit(true); setError('');
    try {
      const fd = new FormData();
      fd.set('title', title.trim());
      fd.set('description', description.trim());
      fd.set('page_url', pageUrl.trim());
      fd.set('type', type);
      fd.set('severity', severity);
      // Repeated under the one key: the route reads them back with getAll.
      for (const f of files) fd.append('screenshot', f);
      const res = await fetch('/api/risansi/bugs', { method: 'POST', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Could not file the bug. Please try again.');
      }
      setDone(true);
      setTimeout(close, 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setSubmit(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={TRIGGER} title="Report a bug">
        <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden>
          <path d="M5.5 6.5a2.5 2.5 0 0 1 5 0v3a2.5 2.5 0 0 1-5 0z" />
          <path d="M8 4V2.5M6 4.8 4.6 3.4M10 4.8l1.4-1.4M5.3 8H2.8M10.7 8h2.5M5.3 11 3.9 12.4M10.7 11l1.4 1.4" />
        </svg>
        Report a Bug
      </button>

      {open && (
        <div style={OVERLAY} onClick={close}>
          {/* Paste is caught on the whole dialog, not just the file field: a
              reporter who has just hit PrtScn pastes wherever the caret is. */}
          <div style={MODAL} onClick={e => e.stopPropagation()} onPaste={onPaste}>
            <div style={HEAD}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>🐞 Report a Bug</span>
              <button type="button" onClick={close} aria-label="Close" style={CLOSE}>×</button>
            </div>

            {done ? (
              <div style={{ padding: '36px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>✓</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pos)' }}>Bug reported — thank you!</div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4 }}>The system admin will pick it up.</div>
              </div>
            ) : (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="Type">
                  <div style={{ display: 'inline-flex', border: '1px solid var(--line-strong)', borderRadius: 7, overflow: 'hidden' }}>
                    {BUG_TYPES.map((t, i) => {
                      const on = type === t;
                      const c = BUG_TYPE_COLORS[t];
                      return (
                        <button key={t} type="button" onClick={() => setType(t)}
                          style={{
                            padding: '6px 18px', fontSize: 13, fontFamily: 'inherit', cursor: on ? 'default' : 'pointer',
                            border: 'none', borderLeft: i === 0 ? 'none' : '1px solid var(--line)',
                            background: on ? c : 'transparent', color: on ? '#fff' : 'var(--fg-2)', fontWeight: on ? 600 : 500,
                          }}>
                          {BUG_TYPE_LABELS[t]}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label="Title" required>
                  <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
                    placeholder="Short summary of the issue" style={INP} autoFocus />
                </Field>

                <Field label="What happened?">
                  <textarea value={description} onChange={e => setDesc(e.target.value)} rows={4} maxLength={5000}
                    placeholder="Steps to reproduce, what you expected, what actually happened…"
                    style={{ ...INP, resize: 'vertical', minHeight: 80 }} />
                </Field>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>
                  <Field label="Severity">
                    <select value={severity} onChange={e => setSeverity(e.target.value as BugSeverity)} style={INP}>
                      {BUG_SEVERITIES.map(s => <option key={s} value={s}>{BUG_SEVERITY_LABELS[s]}</option>)}
                    </select>
                  </Field>
                  <Field label="Page / where">
                    <input value={pageUrl} onChange={e => setPageUrl(e.target.value)} maxLength={500}
                      placeholder="/risansi/…" style={INP} />
                  </Field>
                </div>

                <Field plain label={files.length ? `Screenshots (${files.length})` : 'Screenshots (optional)'}>
                  {files.length > 0 && (
                    <div className="risansi-bug-shots" style={SHOT_GRID}>
                      {files.map((f, i) => (
                        <div key={`${f.name}-${f.lastModified}-${i}`} style={SHOT_TILE}>
                          {previews[i] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={previews[i]} alt={f.name}
                              style={{ width: '100%', height: 64, objectFit: 'cover', display: 'block', background: 'var(--bg-sunk)' }} />
                          )}
                          <div style={SHOT_NAME} title={f.name}>{f.name}</div>
                          <button type="button" onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`} title="Remove" style={SHOT_X}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {files.length < MAX_SHOTS && (
                    <label style={{ ...DROP, marginTop: files.length ? 8 : 0 }}>
                      <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" style={{ display: 'none' }}
                        onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
                      <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                        📎 {files.length ? 'Add another image' : 'Click to attach images'} — or paste a screenshot
                      </span>
                    </label>
                  )}
                </Field>

                {error && <div style={{ fontSize: 12, color: 'var(--neg)' }}>{error}</div>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                  <button type="button" onClick={close} style={BTN_GHOST}>Cancel</button>
                  <button type="button" onClick={submit} disabled={submitting} style={{ ...BTN_PRIMARY, opacity: submitting ? 0.6 : 1 }}>
                    {submitting ? 'Filing…' : 'Submit Bug'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, required, plain, children }: {
  label: string; required?: boolean;
  /**
   * Render as a plain div rather than a label. A label forwards a click on any
   * non-interactive part of itself to its first labelable descendant, so the
   * screenshot field — where tapping a thumbnail would have reached the first
   * tile's Remove button and deleted it — must not be one.
   */
  plain?: boolean;
  children: React.ReactNode;
}) {
  const Tag = plain ? 'div' : 'label';
  return (
    <Tag style={{ display: 'block' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-2)', marginBottom: 4 }}>
        {label}{required && <span style={{ color: 'var(--neg)' }}> *</span>}
      </div>
      {children}
    </Tag>
  );
}

const TRIGGER: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 11px', fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
  color: 'var(--fg)', borderRadius: 5, cursor: 'pointer',
};
const OVERLAY: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(15,23,42,0.45)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px 16px',
};
const MODAL: CSSProperties = {
  width: '100%', maxWidth: 620, background: 'var(--bg-paper)',
  border: '1px solid var(--line-strong)', borderRadius: 10,
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '84vh', overflowY: 'auto',
};
const HEAD: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '13px 16px', borderBottom: '1px solid var(--line)',
};
const CLOSE: CSSProperties = {
  background: 'none', border: 'none', fontSize: 22, lineHeight: 1, color: 'var(--fg-3)', cursor: 'pointer', padding: 0,
};
const INP: CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
  background: 'var(--bg-paper)', color: 'var(--fg)', border: '1px solid var(--line-strong)', borderRadius: 5, outline: 'none',
};
const DROP: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px',
  border: '1px dashed var(--line-strong)', borderRadius: 6, cursor: 'pointer', background: 'var(--bg-sunk)',
};
const SHOT_GRID: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 8,
};
const SHOT_TILE: CSSProperties = {
  position: 'relative', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden', background: 'var(--bg-paper)',
};
const SHOT_NAME: CSSProperties = {
  fontSize: 10, color: 'var(--fg-3)', padding: '3px 5px',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const SHOT_X: CSSProperties = {
  position: 'absolute', top: 3, right: 3, width: 20, height: 20, lineHeight: '18px', textAlign: 'center',
  borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0,
  background: 'rgba(15,23,42,0.72)', color: '#fff', fontSize: 15, fontFamily: 'inherit',
};
const BTN_GHOST: CSSProperties = {
  padding: '7px 14px', fontSize: 13, fontFamily: 'inherit', background: 'none',
  border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 6, cursor: 'pointer',
};
const BTN_PRIMARY: CSSProperties = {
  padding: '7px 16px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', borderRadius: 6, cursor: 'pointer',
};
