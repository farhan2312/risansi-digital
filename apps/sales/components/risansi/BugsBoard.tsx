'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  BUG_STATUSES, BUG_STATUS_LABELS, BUG_STATUS_HINTS, BUG_STATUS_COLORS,
  BUG_SEVERITIES, BUG_SEVERITY_LABELS, BUG_SEVERITY_COLORS,
  BUG_TYPES, BUG_TYPE_LABELS, BUG_TYPE_COLORS, turnaround, type BugStatus,
} from '@/lib/risansi-bugs';
import { updateBugStatus, updateBugSeverity, updateBugType, updateBugResolutionNotes, deleteBug } from '@/app/actions/risansi-bugs';
import { ScreenshotLightbox } from './ScreenshotLightbox';

export interface BugCard {
  id: number;
  title: string;
  description: string | null;
  page_url: string | null;
  type: string;
  severity: string;
  status: string;
  reporter_name: string;
  reporter_email: string | null;
  recorded_by: string | null;
  recorded_at: string | null;
  resolved_by: string | null;
  /** When the fix was handed over for testing. Turnaround is measured to here. */
  testing_at: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  /** Screenshot ids on this bug, oldest first. Served by /api/risansi/bug-screenshot/<id>. */
  screenshot_ids: number[];
}

const ageLabel = (iso: string) => turnaround(iso, new Date());

export function BugsBoard({ initialBugs }: { initialBugs: BugCard[] }) {
  const router = useRouter();
  const [bugs, setBugs]         = useState(initialBugs);
  const [dragId, setDragId]     = useState<number | null>(null);
  const [overCol, setOverCol]   = useState<string | null>(null);
  const [selected, setSelected] = useState<BugCard | null>(null);
  const [saveState, setSave]    = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Re-sync when the server sends fresh data (after a status move / delete).
  const signature = initialBugs.map(b => `${b.id}:${b.status}`).join('|');
  useEffect(() => {
    setBugs(initialBugs);
    // Keep the open modal's copy in sync with the refreshed data too.
    setSelected(sel => (sel ? initialBugs.find(b => b.id === sel.id) ?? null : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const move = async (id: number, status: BugStatus) => {
    const bug = bugs.find(b => b.id === id);
    if (!bug || bug.status === status) return;
    const prev = bugs;
    setBugs(p => p.map(b => (b.id === id ? { ...b, status } : b)));
    setSelected(sel => (sel && sel.id === id ? { ...sel, status } : sel));   // keep open modal in sync
    setSave('saving');
    try {
      await updateBugStatus(id, status);
      setSave('saved'); setTimeout(() => setSave('idle'), 1500);
      router.refresh();
    } catch {
      setBugs(prev); setSave('error'); setTimeout(() => setSave('idle'), 2500);
    }
  };

  const remove = async (id: number) => {
    const prev = bugs;
    setBugs(p => p.filter(b => b.id !== id));
    setSelected(null);
    try { await deleteBug(id); router.refresh(); }
    catch { setBugs(prev); setSave('error'); setTimeout(() => setSave('idle'), 2500); }
  };

  // Save resolution notes. Throws on failure so the modal can surface it inline
  // and keep the admin's draft intact.
  const saveNotes = async (id: number, notes: string) => {
    const prev = bugs;
    const clean = notes.trim() || null;
    setBugs(p => p.map(b => (b.id === id ? { ...b, resolution_notes: clean } : b)));
    setSelected(sel => (sel && sel.id === id ? { ...sel, resolution_notes: clean } : sel));
    try {
      await updateBugResolutionNotes(id, notes);
      router.refresh();
    } catch (e) {
      setBugs(prev);
      setSelected(sel => (sel && sel.id === id ? { ...sel, resolution_notes: prev.find(b => b.id === id)?.resolution_notes ?? null } : sel));
      throw e;
    }
  };

  const retriage = async (id: number, severity: string) => {
    const prev = bugs;
    setBugs(p => p.map(b => (b.id === id ? { ...b, severity } : b)));
    setSelected(sel => (sel && sel.id === id ? { ...sel, severity } : sel));
    setSave('saving');
    try { await updateBugSeverity(id, severity); setSave('saved'); setTimeout(() => setSave('idle'), 1500); router.refresh(); }
    catch { setBugs(prev); setSave('error'); setTimeout(() => setSave('idle'), 2500); }
  };

  const retype = async (id: number, type: string) => {
    const prev = bugs;
    setBugs(p => p.map(b => (b.id === id ? { ...b, type } : b)));
    setSelected(sel => (sel && sel.id === id ? { ...sel, type } : sel));
    setSave('saving');
    try { await updateBugType(id, type); setSave('saved'); setTimeout(() => setSave('idle'), 1500); router.refresh(); }
    catch { setBugs(prev); setSave('error'); setTimeout(() => setSave('idle'), 2500); }
  };

  const byStatus: Record<string, BugCard[]> = {};
  for (const s of BUG_STATUSES) byStatus[s] = bugs.filter(b => b.status === s);

  return (
    <div>
      <div style={{ height: 16, textAlign: 'right', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontStyle: 'italic', color: saveState === 'saved' ? 'var(--pos)' : saveState === 'error' ? 'var(--neg)' : 'var(--fg-3)' }}>
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved'  && '✓ Saved'}
          {saveState === 'error'  && '⚠ Failed — try again'}
        </span>
      </div>

      <div className="r-kanban" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
        {BUG_STATUSES.map(status => {
          const items = byStatus[status] ?? [];
          const isOver = overCol === status;
          const color = BUG_STATUS_COLORS[status];
          return (
            <div
              key={status}
              onDragOver={e => { e.preventDefault(); setOverCol(status); }}
              onDragLeave={() => setOverCol(s => (s === status ? null : s))}
              onDrop={e => { e.preventDefault(); setOverCol(null); if (dragId != null) move(dragId, status); setDragId(null); }}
              style={{
                background: isOver ? 'var(--bg-elev)' : 'var(--bg-paper)',
                border: isOver ? '1px dashed var(--accent)' : '1px solid var(--line)',
                borderRadius: 6, display: 'flex', flexDirection: 'column',
                transition: 'background 120ms, border-color 120ms',
              }}
            >
              <div style={{ padding: '9px 11px', borderBottom: '1px solid var(--line)', borderTop: `2px solid ${color}`, borderRadius: '6px 6px 0 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {BUG_STATUS_LABELS[status]}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{items.length}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 2 }}>{BUG_STATUS_HINTS[status]}</div>
              </div>

              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 60, maxHeight: '58vh', overflowY: 'auto' }}>
                {items.map(bug => (
                  <div
                    key={bug.id}
                    draggable
                    onDragStart={() => setDragId(bug.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => setSelected(bug)}
                    style={{
                      background: 'var(--bg-elev)', border: '1px solid var(--line)',
                      borderLeft: `3px solid ${BUG_SEVERITY_COLORS[bug.severity as keyof typeof BUG_SEVERITY_COLORS] ?? 'var(--line)'}`,
                      borderRadius: 4, padding: '8px 9px', cursor: 'pointer',
                      opacity: dragId === bug.id ? 0.4 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: BUG_SEVERITY_COLORS[bug.severity as keyof typeof BUG_SEVERITY_COLORS] ?? 'var(--fg-3)' }}>
                          {BUG_SEVERITY_LABELS[bug.severity as keyof typeof BUG_SEVERITY_LABELS] ?? bug.severity}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '1px 5px', borderRadius: 3, color: '#fff', background: BUG_TYPE_COLORS[bug.type as keyof typeof BUG_TYPE_COLORS] ?? 'var(--fg-3)' }}>
                          {BUG_TYPE_LABELS[bug.type as keyof typeof BUG_TYPE_LABELS] ?? bug.type}
                        </span>
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>#{bug.id}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.3, overflowWrap: 'anywhere' }}>{bug.title}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 5, fontSize: 10, color: 'var(--fg-3)' }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bug.reporter_name}</span>
                      <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)' }}>{ageLabel(bug.created_at)}{bug.screenshot_ids.length ? ` · 📎${bug.screenshot_ids.length > 1 ? bug.screenshot_ids.length : ''}` : ''}</span>
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <div style={{ fontSize: 10, color: 'var(--fg-3)', textAlign: 'center', padding: 18 }}>
                    {isOver ? 'Drop here' : '—'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <BugDetailModal key={selected.id} bug={selected} onClose={() => setSelected(null)}
          onMove={move} onSeverity={retriage} onType={retype} onSaveNotes={saveNotes} onDelete={remove} />
      )}
    </div>
  );
}

function BugDetailModal({ bug, onClose, onMove, onSeverity, onType, onSaveNotes, onDelete }: {
  bug: BugCard; onClose: () => void; onMove: (id: number, s: BugStatus) => void;
  onSeverity: (id: number, s: string) => void; onType: (id: number, t: string) => void;
  onSaveNotes: (id: number, notes: string) => Promise<void>; onDelete: (id: number) => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [notes, setNotes]           = useState(bug.resolution_notes ?? '');
  const [notesState, setNotesState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Which screenshot the lightbox is showing; null while it is closed.
  const [shotIdx, setShotIdx]       = useState<number | null>(null);
  const dirty = notes.trim() !== (bug.resolution_notes ?? '').trim();
  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  const doSaveNotes = async () => {
    setNotesState('saving');
    try { await onSaveNotes(bug.id, notes); setNotesState('saved'); setTimeout(() => setNotesState('idle'), 1600); }
    catch { setNotesState('error'); setTimeout(() => setNotesState('idle'), 2800); }
  };

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={MODAL} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '13px 16px', borderBottom: '1px solid var(--line)', gap: 10 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: BUG_SEVERITY_COLORS[bug.severity as keyof typeof BUG_SEVERITY_COLORS] ?? 'var(--fg-3)' }}>
                {BUG_SEVERITY_LABELS[bug.severity as keyof typeof BUG_SEVERITY_LABELS] ?? bug.severity}
              </span>
              <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>#{bug.id}</span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', marginTop: 3, overflowWrap: 'anywhere' }}>{bug.title}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, color: 'var(--fg-3)', cursor: 'pointer', flexShrink: 0 }}>×</button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Status pipeline stepper */}
          <div>
            <div style={LBL}>Status</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {BUG_STATUSES.map(s => {
                const active = bug.status === s;
                return (
                  <button key={s} type="button" onClick={() => { if (!active) onMove(bug.id, s); }}
                    style={{
                      padding: '5px 10px', fontSize: 11, fontWeight: active ? 700 : 500, fontFamily: 'inherit',
                      borderRadius: 20, cursor: active ? 'default' : 'pointer',
                      background: active ? BUG_STATUS_COLORS[s] : 'var(--bg-paper)',
                      color: active ? '#fff' : 'var(--fg-2)',
                      border: `1px solid ${active ? BUG_STATUS_COLORS[s] : 'var(--line-strong)'}`,
                    }}>
                    {BUG_STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {/* Type reclassify */}
            <div>
              <div style={LBL}>Type</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {BUG_TYPES.map(t => {
                  const active = bug.type === t;
                  const c = BUG_TYPE_COLORS[t];
                  return (
                    <button key={t} type="button" onClick={() => { if (!active) onType(bug.id, t); }}
                      style={{
                        padding: '4px 12px', fontSize: 11, fontWeight: active ? 700 : 500, fontFamily: 'inherit',
                        borderRadius: 6, cursor: active ? 'default' : 'pointer',
                        background: active ? c : 'var(--bg-paper)', color: active ? '#fff' : 'var(--fg-2)',
                        border: `1px solid ${active ? c : 'var(--line-strong)'}`,
                      }}>
                      {BUG_TYPE_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Severity re-triage */}
            <div>
              <div style={LBL}>Severity</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {BUG_SEVERITIES.map(s => {
                  const active = bug.severity === s;
                  const c = BUG_SEVERITY_COLORS[s];
                  return (
                    <button key={s} type="button" onClick={() => { if (!active) onSeverity(bug.id, s); }}
                      style={{
                        padding: '4px 12px', fontSize: 11, fontWeight: active ? 700 : 500, fontFamily: 'inherit',
                        borderRadius: 6, cursor: active ? 'default' : 'pointer',
                        background: active ? c : 'var(--bg-paper)', color: active ? '#fff' : 'var(--fg-2)',
                        border: `1px solid ${active ? c : 'var(--line-strong)'}`,
                      }}>
                      {BUG_SEVERITY_LABELS[s]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {bug.description && (
            <div>
              <div style={LBL}>Description</div>
              <div style={{ fontSize: 13, color: 'var(--fg)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{bug.description}</div>
            </div>
          )}

          {bug.page_url && (
            <div>
              <div style={LBL}>Page</div>
              <div style={{ fontSize: 12, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{bug.page_url}</div>
            </div>
          )}

          {bug.screenshot_ids.length > 0 && (
            <div>
              <div style={LBL}>{bug.screenshot_ids.length > 1 ? `Screenshots (${bug.screenshot_ids.length})` : 'Screenshot'}</div>
              {/* Stacked rather than tiled: a screenshot is unreadable at thumbnail
                  size, and the admin is reading them to understand the report. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bug.screenshot_ids.map((sid, i) => (
                  <button key={sid} type="button" onClick={() => setShotIdx(i)}
                    aria-label={bug.screenshot_ids.length > 1 ? `Enlarge screenshot ${i + 1} of ${bug.screenshot_ids.length}` : 'Enlarge screenshot'}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'zoom-in', display: 'block', textAlign: 'left' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- dynamic API-route image, next/image can't optimise it */}
                    <img src={`/api/risansi/bug-screenshot/${sid}`} alt="Bug screenshot"
                      style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 6, border: '1px solid var(--line)', display: 'block' }} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {shotIdx !== null && (
            <ScreenshotLightbox
              srcs={bug.screenshot_ids.map(sid => `/api/risansi/bug-screenshot/${sid}`)}
              index={shotIdx}
              onIndexChange={setShotIdx}
              onClose={() => setShotIdx(null)}
              subject={`bug #${bug.id}`}
            />
          )}

          {/* Resolution notes */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={LBL}>Resolution Notes</span>
              <span style={{ fontSize: 11, fontStyle: 'italic', color: notesState === 'saved' ? 'var(--pos)' : notesState === 'error' ? 'var(--neg)' : 'var(--fg-3)' }}>
                {notesState === 'saving' && 'Saving…'}
                {notesState === 'saved'  && '✓ Saved'}
                {notesState === 'error'  && '⚠ Failed — try again'}
              </span>
            </div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Root cause, how it was fixed, what to verify…"
              rows={4}
              maxLength={8000}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 76,
                padding: '9px 11px', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5,
                color: 'var(--fg)', background: 'var(--bg-elev)',
                border: '1px solid var(--line-strong)', borderRadius: 6,
              }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button type="button" onClick={doSaveNotes} disabled={!dirty || notesState === 'saving'}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                  borderRadius: 6, border: 'none',
                  cursor: dirty && notesState !== 'saving' ? 'pointer' : 'default',
                  background: dirty ? 'var(--accent)' : 'var(--bg-sunk)',
                  color: dirty ? '#fff' : 'var(--fg-3)',
                }}>
                {notesState === 'saving' ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </div>

          {/* Timeline / turnaround */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '12px 14px', background: 'var(--bg-sunk)', borderRadius: 6 }}>
            <TimeRow label="Reported" who={bug.reporter_name} when={fmt(bug.created_at)} />
            <TimeRow label="Picked up" who={bug.recorded_by} when={fmt(bug.recorded_at)} />
            <TimeRow label="Handed over" who={null} when={fmt(bug.testing_at)} />
            <TimeRow label="Resolved" who={bug.resolved_by} when={fmt(bug.resolved_at)} />
            {/* To the handover, not to the verification: once it is with the
                reporter the clock is theirs, and a bug waiting a week to be
                checked did not take a week to fix. Testing where there is one,
                else the day it was fixed — a bug closed without a testing round
                was still handed over then. */}
            <TimeRow label="Turnaround" who={null}
              when={turnaround(bug.created_at, bug.testing_at ?? bug.resolved_at)} accent />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
            {confirmDel ? (
              <>
                <span style={{ fontSize: 12, color: 'var(--neg)', alignSelf: 'center', marginRight: 'auto' }}>Delete this bug permanently?</span>
                <button type="button" onClick={() => setConfirmDel(false)} style={BTN_GHOST}>Cancel</button>
                <button type="button" onClick={() => onDelete(bug.id)} style={{ ...BTN_GHOST, color: 'var(--on-accent)', background: 'var(--neg-fill)', border: 'none' }}>Delete</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDel(true)} style={{ ...BTN_GHOST, color: 'var(--neg)' }}>Delete bug</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TimeRow({ label, who, when, accent }: { label: string; who: string | null; when: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)' }}>{label}</div>
      <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: accent ? 'var(--accent)' : 'var(--fg)', marginTop: 1 }}>{when}</div>
      {who && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 1 }}>{who}</div>}
    </div>
  );
}

const LBL: CSSProperties = { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 5 };
const OVERLAY: CSSProperties = { position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px 16px' };
const MODAL: CSSProperties = { width: '100%', maxWidth: 680, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '88vh', overflowY: 'auto' };
const BTN_GHOST: CSSProperties = { padding: '7px 14px', fontSize: 12, fontFamily: 'inherit', background: 'none', border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 6, cursor: 'pointer' };
