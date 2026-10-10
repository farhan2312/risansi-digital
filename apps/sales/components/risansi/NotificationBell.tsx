'use client';

import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';

// The notification bell + drawer. Reads the signed-in user's feed from
// /api/risansi/notifications (scoped server-side to their own id), shows an
// unread badge, and opens a panel of recent items. Clicking an item marks it
// read and opens its link; "Mark all read" clears the badge.
//
// The unread count is polled on a slow interval so the badge stays roughly live
// without a socket; the full feed is only fetched when the panel opens.

interface Item {
  id: number;
  kind: string;
  section: string | null;
  title: string;
  body: string | null;
  link: string | null;
  actor: string | null;
  read_at: string | null;
  created_at: string;
}

const POLL_MS = 60_000;

// Section → accent, matching the email template's per-domain colours.
const SECTION_HUE: Record<string, string> = {
  Pipeline: 'var(--accent)',
  'Order Booked': 'var(--pos)',
  Complaints: 'var(--neg)',
  'Action Registry': 'var(--brand-blue)',
  Field: 'var(--brand-blue)',
  'Visit Reports': 'var(--pos)',
  'Visit Planner': 'var(--brand-blue)',
  Clients: 'var(--brand-blue)',
  'Client Access': 'var(--brand-blue)',
  Expansion: 'var(--accent)',
  Bugs: 'var(--neg)',
};

function ago(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen]       = useState(false);
  const [unread, setUnread]   = useState(0);
  const [items, setItems]     = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Badge only — cheap, on a slow poll.
  const refreshCount = useCallback(async () => {
    try {
      const r = await fetch('/api/risansi/notifications', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      setUnread(d.unread ?? 0);
    } catch { /* offline / transient — leave the badge as it was */ }
  }, []);

  // Full feed — only when the panel opens.
  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/risansi/notifications', { cache: 'no-store' });
      const d = r.ok ? await r.json() : { items: [], unread: 0 };
      setItems(d.items ?? []);
      setUnread(d.unread ?? 0);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(t);
  }, [refreshCount]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadFeed();
  };

  const markRead = useCallback(async (ids: number[]) => {
    if (!ids.length) return;
    setItems(prev => prev?.map(i => ids.includes(i.id) && !i.read_at ? { ...i, read_at: new Date().toISOString() } : i) ?? prev);
    setUnread(u => Math.max(0, u - ids.length));
    try { await fetch('/api/risansi/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', ids }) }); }
    catch { /* optimistic; the next poll will reconcile */ }
  }, []);

  const markAll = useCallback(async () => {
    setItems(prev => prev?.map(i => i.read_at ? i : { ...i, read_at: new Date().toISOString() }) ?? prev);
    setUnread(0);
    try { const r = await fetch('/api/risansi/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read_all' }) }); if (r.ok) { const d = await r.json(); setUnread(d.unread ?? 0); } }
    catch { /* optimistic */ }
  }, []);

  const openItem = (i: Item) => {
    if (!i.read_at) markRead([i.id]);
    setOpen(false);
    if (i.link) router.push(i.link);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button" onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: 7, border: '1px solid transparent',
          background: open ? 'var(--bg-elev)' : 'transparent', color: 'var(--fg-2)', cursor: 'pointer',
        }}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2, minWidth: 15, height: 15, padding: '0 4px',
            borderRadius: 8, background: 'var(--neg-fill)', color: 'var(--on-accent)', fontSize: 9.5, fontWeight: 700,
            lineHeight: '15px', textAlign: 'center', fontFamily: 'var(--font-mono, monospace)',
            boxShadow: '0 0 0 2px var(--bg-paper)',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={PANEL} role="dialog" aria-label="Notifications">
          <div style={HEAD}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Notifications</span>
            {(items?.some(i => !i.read_at) ?? false) && (
              <button type="button" onClick={markAll} style={LINKBTN}>Mark all read</button>
            )}
          </div>

          <div style={{ overflowY: 'auto', maxHeight: '60vh' }}>
            {loading && items === null ? (
              <div style={EMPTY}>Loading…</div>
            ) : !items || items.length === 0 ? (
              <div style={EMPTY}>You're all caught up. Notifications about your clients, visits and deals will show here.</div>
            ) : (
              items.map(i => {
                const hue = (i.section && SECTION_HUE[i.section]) || 'var(--fg-3)';
                const unreadRow = !i.read_at;
                return (
                  <button
                    key={i.id} type="button" onClick={() => openItem(i)}
                    style={{
                      ...ROW,
                      background: unreadRow ? 'color-mix(in srgb, var(--brand-blue) 6%, transparent)' : 'transparent',
                      cursor: i.link ? 'pointer' : 'default',
                    }}
                  >
                    <span style={{ width: 7, display: 'flex', justifyContent: 'center', paddingTop: 5, flexShrink: 0 }}>
                      {unreadRow && <span style={{ width: 6, height: 6, borderRadius: '50%', background: hue, display: 'block' }} />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                        {i.section && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: hue }}>{i.section}</span>}
                        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>{ago(i.created_at)}</span>
                      </span>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: unreadRow ? 600 : 500, color: 'var(--fg)', lineHeight: 1.35 }}>{i.title}</span>
                      {i.body && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.body}</span>}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const PANEL: CSSProperties = {
  position: 'absolute', top: 40, right: 0, width: 360, maxWidth: '92vw', zIndex: 200,
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 12,
  boxShadow: '0 12px 40px rgba(0,0,0,0.18)', overflow: 'hidden',
};
const HEAD: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '11px 14px', borderBottom: '1px solid var(--line)',
};
const LINKBTN: CSSProperties = {
  background: 'none', border: 'none', color: 'var(--brand-blue)', fontSize: 11.5, fontWeight: 500,
  cursor: 'pointer', padding: 0, fontFamily: 'inherit',
};
const ROW: CSSProperties = {
  display: 'flex', gap: 8, width: '100%', textAlign: 'left', padding: '10px 14px',
  border: 'none', borderBottom: '1px solid var(--line-2, var(--line))', fontFamily: 'inherit',
};
const EMPTY: CSSProperties = {
  padding: '28px 20px', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.5,
};
