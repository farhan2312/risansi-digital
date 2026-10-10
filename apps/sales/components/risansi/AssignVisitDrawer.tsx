'use client';

import {
  useState, useEffect, useRef, useTransition, type CSSProperties,
} from 'react';
import { useRouter } from 'next/navigation';
import { assignVisit } from '@/app/actions/risansi';
import { PLAN_VISIT_LABEL, localDateStr } from '@/lib/risansi-utils';

// ── Types ──────────────────────────────────────────────────────

export interface DrawerRep {
  id: string;
  name: string;
  route?: string | null;
}

interface ClientResult {
  id: string;
  code: string;
  legal_name: string;
  city: string | null;
  state: string | null;
  industry: string | null;
}

interface OverdueClient extends ClientResult {
  days_since: number | null;
}

interface DrawerPayload {
  clientId?: string;
  clientName?: string;
  clientCode?: string;
  repId?: string;
  lockClient?: boolean;
}

export const OPEN_VISIT_DRAWER = 'risansi:open-assign-drawer';

const PURPOSES = [
  'Routine',
  'Quote Follow-up',
  'Complaint Resolution',
  'New Opportunity',
  'Equipment Assessment',
  'Management Relationship Visit',
];

// ── Row button — dispatches event to open the drawer ──────────

export function AssignVisitRowBtn({
  clientId, clientName, clientCode, repId,
}: DrawerPayload) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_VISIT_DRAWER, {
        detail: { clientId, clientName, clientCode, repId },
      }))}
      style={ROW_BTN}
    >
      {PLAN_VISIT_LABEL}
    </button>
  );
}

// ── Main drawer ────────────────────────────────────────────────

export default function AssignVisitDrawer({
  reps,
  hideButton = false,
  onSuccess,
  role,
  repId,
  currentUserName,
  // Controlled API (used by Client 360) — open/close via props, with the
  // client pre-filled. When `controlledOpen` is undefined the drawer falls
  // back to its internal event-driven behaviour (used by the calendar).
  controlledOpen,
  onClose,
  prefilledClient,
  prefilledRepId,
  lockClient: lockClientProp,
}: {
  reps: DrawerRep[];
  hideButton?: boolean;
  onSuccess?: () => void;
  role?: string;
  repId?: string | number | null;
  currentUserName?: string;
  controlledOpen?: boolean;
  onClose?: () => void;
  prefilledClient?: { id: string; code?: string; legal_name: string } | null;
  prefilledRepId?: string | number | null;   // client's primary rep — default/fallback
  lockClient?: boolean;
}) {
  const router = useRouter();

  const isRepUser = role === 'rep';

  const [open, setOpen]               = useState(false);
  const [isPending, startTransition]  = useTransition();
  const [formKey, setFormKey]         = useState(0);
  const [prefillRepId, setPrefillRepId] = useState('');
  const [currentRepName, setCurrentRepName] = useState('');

  // Admin/manager rep dropdown — fetch the list directly (the `reps` prop can
  // arrive empty if the page's own query failed). Fall back to the prop.
  const [fetchedReps, setFetchedReps] = useState<Array<{ id: string; name: string; zone?: string | null; route?: string | null }>>([]);
  useEffect(() => {
    if (isRepUser) return;
    fetch('/api/risansi/reps')
      .then(r => { if (!r.ok) throw new Error('Failed to fetch reps'); return r.json(); })
      .then(d => setFetchedReps(Array.isArray(d) ? d : []))
      .catch(err => { console.error('Failed to load reps:', err); setFetchedReps([]); });
  }, [isRepUser]);
  const allRepOptions: Array<{ id: string; name: string; zone?: string | null; route?: string | null }> =
    fetchedReps.length ? fetchedReps : reps.map(r => ({ id: String(r.id), name: r.name, route: r.route ?? null }));

  // Once a client is chosen, the list narrows to the people who may be sent to
  // it: owner, covering reps, their managers, admins. The server refuses anyone
  // else (whyCannotVisitClient), so offering them would only be offering a
  // refusal. `null` means not yet known — the full list shows until then.
  const [candidates, setCandidates] = useState<{ ids: string[]; owner: string | null; covering: string[] } | null>(null);

  // Managers default the rep dropdown to themselves when no client-primary
  // prefill is supplied (e.g. the header / calendar "Plan Visit" button).
  // Applied in the open handlers below so it never fights a manual selection.
  const managerDefaultRepId =
    !isRepUser && role === 'manager' && repId != null ? String(repId) : '';

  // A rep is locked to themselves — fetch their own name for the read-only display.
  useEffect(() => {
    if (!isRepUser || repId == null) return;
    fetch('/api/risansi/reps')
      .then(r => r.json())
      .then((data: Array<{ id: string | number; name: string }>) => {
        if (!Array.isArray(data)) return;
        const me = data.find(r => String(r.id) === String(repId));
        if (me) setCurrentRepName(me.name);
      })
      .catch(() => {});
  }, [isRepUser, repId]);

  // Client search
  const [query, setQuery]                   = useState('');
  const [results, setResults]               = useState<ClientResult[]>([]);
  const [showResults, setShowResults]       = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientResult | null>(null);
  const [searching, setSearching]           = useState(false);
  const [lockClientMode, setLockClientMode] = useState(false);
  const [overdue, setOverdue]               = useState<OverdueClient[]>([]);

  // Feedback
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState('');

  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (isRepUser) return;
    if (!selectedClient) { setCandidates(null); return; }
    let alive = true;
    setCandidates(null);
    fetch(`/api/risansi/visit-candidates?clientId=${encodeURIComponent(selectedClient.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { ids?: string[]; owner?: string | null; covering?: string[] } | null) => {
        if (!alive || !d || !Array.isArray(d.ids)) return;
        setCandidates({ ids: d.ids.map(String), owner: d.owner ?? null, covering: d.covering ?? [] });
        // A prefilled rep who does not work this client is cleared rather than
        // left selected and refused on save.
        setPrefillRepId(cur => (cur && !d.ids!.map(String).includes(cur) ? '' : cur));
      })
      .catch(() => { /* full list stays; the server still decides */ });
    return () => { alive = false; };
  }, [isRepUser, selectedClient]);

  const repOptions = candidates
    ? allRepOptions.filter(r => candidates.ids.includes(String(r.id)))
    : allRepOptions;

  // ── Listen for row-button / external open events ──────────

  useEffect(() => {
    function handleOpen(e: Event) {
      const p = (e as CustomEvent<DrawerPayload>).detail;
      const lock = p.lockClient ?? false;
      setLockClientMode(lock);
      setPrefillRepId(p.repId ?? managerDefaultRepId);
      if (p.clientId && p.clientName) {
        setSelectedClient({
          id: p.clientId, code: p.clientCode ?? '',
          legal_name: p.clientName,
          city: null, state: null, industry: null,
        });
        setQuery(p.clientName);
      } else {
        setSelectedClient(null);
        setQuery('');
      }
      setResults([]);
      setShowResults(false);
      setSuccess(false);
      setError('');
      setFormKey(k => k + 1);
      setOpen(true);
    }
    window.addEventListener(OPEN_VISIT_DRAWER, handleOpen);
    return () => window.removeEventListener(OPEN_VISIT_DRAWER, handleOpen);
    // managerDefaultRepId is derived from stable server-session props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Controlled open (Client 360 etc.) ─────────────────────
  // When the parent toggles `controlledOpen`, open/close the drawer and
  // pre-fill the client. Mirrors the event handler above for the prop path.
  useEffect(() => {
    if (controlledOpen === undefined) return;
    if (controlledOpen) {
      setLockClientMode(lockClientProp ?? false);
      setPrefillRepId(prefilledRepId != null ? String(prefilledRepId) : managerDefaultRepId);
      if (prefilledClient) {
        setSelectedClient({
          id: prefilledClient.id,
          code: prefilledClient.code ?? '',
          legal_name: prefilledClient.legal_name,
          city: null, state: null, industry: null,
        });
        setQuery(prefilledClient.legal_name);
      } else {
        setSelectedClient(null);
        setQuery('');
      }
      setResults([]);
      setShowResults(false);
      setSuccess(false);
      setError('');
      setFormKey(k => k + 1);
      setOpen(true);
    } else {
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledOpen]);

  // ── Client search with debounce (skip when locked) ────────

  useEffect(() => {
    if (lockClientMode) return;
    if (query.length < 2) { setResults([]); setSearching(false); return; }
    clearTimeout(searchTimer.current);
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/risansi/clients-search?q=${encodeURIComponent(query)}`);
        const data = await res.json() as ClientResult[];
        setResults(data);
        setShowResults(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [query, lockClientMode]);

  // Recommended overdue accounts — fetched once; shown when no search is typed
  // and no client is selected yet, so a rep can plan against an overdue client
  // in one tap instead of searching.
  useEffect(() => {
    fetch('/api/risansi/overdue-clients')
      .then(r => (r.ok ? r.json() : []))
      .then((d: OverdueClient[]) => setOverdue(Array.isArray(d) ? d : []))
      .catch(() => setOverdue([]));
  }, []);

  // ── Helpers ────────────────────────────────────────────────

  function openFresh() {
    setLockClientMode(false);
    setPrefillRepId('');
    setSelectedClient(null);
    setQuery('');
    setResults([]);
    setShowResults(false);
    setSuccess(false);
    setError('');
    setFormKey(k => k + 1);
    setOpen(true);
  }

  function close() { setOpen(false); onClose?.(); }

  function nextWorkday(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 6) d.setDate(d.getDate() + 2);
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    return localDateStr(d);
  }

  // ── Submit ─────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedClient) {
      setError('Please select a client from the search results.');
      return;
    }
    setError('');
    const fd = new FormData(e.currentTarget);
    fd.set('client_id', String(selectedClient.id));

    startTransition(async () => {
      try {
        // Refusals come back as a result, with the reason spelled out — which
        // rep owns the client, or that nobody does. A thrown error here is a
        // genuine failure and is redacted in production, so it gets the
        // generic line.
        const res = await assignVisit(fd);
        if (!res.ok) { setError(res.error); return; }
        setSuccess(true);
        onSuccess?.();
        setTimeout(() => {
          setSuccess(false);
          close();
          router.refresh();
        }, 1200);
      } catch (err) {
        console.error('[Plan Visit] assignVisit failed', err);
        setError('Failed to schedule visit — please try again.');
      }
    });
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <>
      {/* Header trigger button — hidden when embedded in ClientActionButtons */}
      {!hideButton && (
        <button type="button" onClick={openFresh} style={PRIMARY_BTN}>
          {PLAN_VISIT_LABEL}
        </button>
      )}

      {/* Backdrop */}
      {open && (
        // The backdrop dims, it does not close: a click that strays past the
        // drawer's edge used to throw away the visit being planned. The x in
        // the header and Escape close it.
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 40,
            background: 'rgba(10,22,40,0.35)',
          }}
        />
      )}

      {/* Slide-in drawer */}
      <div className="risansi-drawer" onKeyDown={(e) => { if (e.key === 'Escape') close(); }} style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 480, zIndex: 50,
        background: 'var(--bg-paper)', color: 'var(--fg)',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.35)',
        display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.26s cubic-bezier(0.32,0,0.67,0)',
      }}>

        {/* Drawer header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--title)', letterSpacing: '-0.01em' }}>
              {PLAN_VISIT_LABEL}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
              {lockClientMode
                ? `Schedule a visit for ${selectedClient?.legal_name ?? 'this client'}`
                : 'Schedule a planned visit for a rep'}
            </div>
          </div>
          <button type="button" onClick={close} style={CLOSE_BTN}>✕</button>
        </div>

        {/* Form — re-keyed each open so defaultValues apply fresh */}
        <form
          key={formKey}
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}
        >

          {/* 1 · Client */}
          <div>
            <label style={LBL}>Client <Req /></label>
            {lockClientMode && selectedClient ? (
              /* Read-only display when client is pre-filled and locked */
              <div style={{
                padding: '10px 12px',
                background: 'var(--bg-sunk)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                fontSize: 13,
                color: 'var(--fg-2)',
              }}>
                {selectedClient.legal_name}
                {selectedClient.code ? ` · ${selectedClient.code}` : ''}
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={query}
                  onChange={e => {
                    setQuery(e.target.value);
                    if (selectedClient) setSelectedClient(null);
                  }}
                  onFocus={() => { if (results.length > 0) setShowResults(true); }}
                  onBlur={() => setTimeout(() => setShowResults(false), 180)}
                  placeholder="Search by name, code, or city…"
                  style={{
                    ...INP,
                    borderColor: query.length > 1 && !selectedClient ? '#F59E0B' : 'var(--line-strong)',
                  }}
                  autoComplete="off"
                />
                {searching && (
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--fg-3)' }}>
                    searching…
                  </span>
                )}
                {selectedClient && (
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--pos)' }}>
                    ✓
                  </span>
                )}
                {showResults && results.length > 0 && (
                  <div style={DROP}>
                    {results.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={() => {
                          setSelectedClient(c);
                          setQuery(c.legal_name);
                          setShowResults(false);
                        }}
                        style={DROP_ITEM}
                      >
                        <span style={{ fontWeight: 500, fontSize: 13 }}>{c.legal_name}</span>
                        <span style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                          {c.code}{c.city ? ` · ${c.city}` : ''}{c.industry ? ` · ${c.industry}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <input type="hidden" name="client_id" value={selectedClient?.id ?? ''} />
            {!lockClientMode && selectedClient && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--fg-3)' }}>
                {selectedClient.code}
                {selectedClient.city ? ` · ${selectedClient.city}` : ''}
                {selectedClient.industry ? ` · ${selectedClient.industry}` : ''}
              </div>
            )}

            {/* Recommended overdue accounts — one-tap pick before searching */}
            {!lockClientMode && !selectedClient && query.trim().length < 2 && overdue.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                  Recommended · overdue accounts
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                  {overdue.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setSelectedClient(c); setQuery(c.legal_name); setShowResults(false); }}
                      style={REC_ITEM}
                    >
                      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--fg)' }}>{c.legal_name}</span>
                        <span style={{ fontSize: 11, color: 'var(--neg)', fontFamily: 'monospace', flexShrink: 0 }}>
                          {c.days_since != null ? `${c.days_since}d overdue` : 'Never visited'}
                        </span>
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                        {c.code}{c.city ? ` · ${c.city}` : ''}{c.industry ? ` · ${c.industry}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 2 · Rep */}
          {isRepUser ? (
            <div>
              <label style={LBL}>Rep</label>
              <div style={{
                padding: '9px 12px', background: 'var(--bg-sunk)',
                border: '1px solid var(--line)', borderRadius: 6,
                fontSize: 13, color: 'var(--fg-2)',
              }}>
                {currentUserName || currentRepName || 'You'}
                <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--fg-3)', fontStyle: 'italic' }}>(You)</span>
              </div>
              <input
                type="hidden"
                name="rep_id"
                value={repId != null ? String(repId) : (prefilledRepId != null ? String(prefilledRepId) : '')}
              />
            </div>
          ) : (
            <div>
              <label style={LBL}>Rep <Req /></label>
              {allRepOptions.length === 0 ? (
                <select disabled style={{ ...INP, color: 'var(--fg-3)' }}>
                  <option>Loading reps…</option>
                </select>
              ) : (
                <select name="rep_id" value={prefillRepId} onChange={e => setPrefillRepId(e.target.value)} style={INP}>
                  <option value="">— Select Rep —</option>
                  {repOptions.map(r => (
                    <option key={r.id} value={String(r.id)}>
                      {r.name}{r.zone ? ` · ${r.zone}` : r.route ? ` · ${r.route}` : ''}
                    </option>
                  ))}
                </select>
              )}
              {candidates && selectedClient && (
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 5, lineHeight: 1.5 }}>
                  {candidates.owner || candidates.covering.length ? (
                    <>
                      Only people who work this client
                      {candidates.owner && <> — assigned to <strong style={{ color: 'var(--fg-2)' }}>{candidates.owner}</strong></>}
                      {candidates.covering.length > 0 && <>, covered by {candidates.covering.join(', ')}</>}
                      . To send someone else, add them as a covering rep on Admin › Reps &amp; Managers first.
                    </>
                  ) : (
                    <span style={{ color: 'var(--warn-strong, var(--warn))' }}>
                      Nobody is assigned to this client yet, so only an admin can be sent. Assign an owner on
                      Admin › Reps &amp; Managers › Unassigned first.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3 · Visit Date */}
          <div>
            <label style={LBL}>Visit Date <Req /></label>
            <input
              type="date"
              name="visit_date"
              defaultValue={nextWorkday()}
              style={INP}
              required
            />
          </div>

          {/* 4 · Purpose */}
          <div>
            <label style={LBL}>Purpose <Req /></label>
            <select name="purpose" style={INP} required>
              {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* 5 · Notes */}
          <div>
            <label style={LBL}>
              Notes{' '}
              <span style={{ color: 'var(--fg-3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                (optional)
              </span>
            </label>
            <textarea
              name="notes"
              maxLength={500}
              rows={3}
              placeholder="Specific objectives, context, or talking points…"
              style={{ ...INP, height: 'auto', resize: 'vertical', paddingTop: 9, paddingBottom: 9, lineHeight: 1.5 }}
            />
          </div>

          {/* 6 · Planned checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
            <input
              type="checkbox"
              name="is_planned"
              defaultChecked
              style={{ width: 15, height: 15, accentColor: 'var(--brand-blue)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>Mark as planned visit</span>
          </label>

          {/* Error */}
          {error && (
            <div style={{
              padding: '9px 12px',
              background: 'var(--neg-soft)', border: '1px solid var(--neg)',
              borderRadius: 5, fontSize: 12, color: 'var(--neg-strong)',
            }}>
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div style={{
              padding: '12px 16px',
              background: 'var(--pos-soft)', border: '1px solid var(--pos)',
              borderRadius: 6, fontSize: 13, color: 'var(--pos-strong)',
              textAlign: 'center', fontWeight: 600,
            }}>
              ✓ Visit scheduled successfully!
            </div>
          )}

          {/* Submit */}
          {!success && (
            <button
              type="submit"
              disabled={isPending || !selectedClient}
              style={{
                ...SUBMIT_BTN,
                opacity: isPending || !selectedClient ? 0.55 : 1,
                cursor: isPending || !selectedClient ? 'not-allowed' : 'pointer',
              }}
            >
              {isPending ? 'Scheduling…' : 'Schedule Visit'}
            </button>
          )}
        </form>
      </div>
    </>
  );
}

function Req() {
  return <span style={{ color: 'var(--neg)', marginLeft: 2 }}>*</span>;
}

// ── Styles ─────────────────────────────────────────────────────

const PRIMARY_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 14px', fontSize: 13, fontFamily: 'inherit',
  fontWeight: 600, background: 'var(--accent-fill)', color: 'var(--on-accent)',
  border: 'none', borderRadius: 6, cursor: 'pointer',
  letterSpacing: '-0.005em', flexShrink: 0,
};

const ROW_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px', fontSize: 11, fontFamily: 'inherit',
  fontWeight: 500, background: 'transparent',
  border: '1px solid var(--line-strong)', color: 'var(--brand-blue)',
  borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap',
};

const CLOSE_BTN: CSSProperties = {
  width: 28, height: 28, display: 'grid', placeItems: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 16, color: 'var(--fg-3)', borderRadius: 4,
};

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '9px 12px',
  fontSize: 13, fontFamily: 'inherit',
  background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg)', outline: 'none',
  boxSizing: 'border-box',
};

const DROP: CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60,
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 6, boxShadow: '0 4px 20px rgba(10,22,40,0.28)',
  maxHeight: 260, overflowY: 'auto', marginTop: 2,
};

const DROP_ITEM: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
  width: '100%', padding: '10px 14px',
  background: 'transparent', border: 'none',
  borderBottom: '1px solid var(--line)', color: 'var(--fg)',
  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
};

const REC_ITEM: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'stretch',
  width: '100%', padding: '9px 12px',
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderLeft: '3px solid var(--neg)', borderRadius: 6,
  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
};

const SUBMIT_BTN: CSSProperties = {
  width: '100%', padding: '12px 0',
  fontSize: 14, fontFamily: 'inherit', fontWeight: 600,
  background: 'var(--accent-fill)', color: 'var(--on-accent)',
  border: 'none', borderRadius: 6,
  letterSpacing: '-0.005em', marginTop: 4,
};
