'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  EXHIBITION_STATUSES, OPEN_STATUSES, STATUS_TONE, PARTICIPATION,
  DISCOVERY_SOURCES, fmtInr, eventDays,
  type ExhibitionStatus,
} from '@/lib/risansi-exhibition-fields';
import { createExhibition } from '@/app/actions/risansi-exhibitions';
import { useTableSort, SortTH } from './SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';

export interface ExhibitionRow {
  id: number; name: string; organizer: string | null; venue: string | null;
  city: string | null; state: string | null; country: string | null;
  industry: string | null; source: string | null; website: string | null;
  start_date: string | null; end_date: string | null;
  status: ExhibitionStatus; participation: string | null; suggested: string | null;
  estimated_cost_inr: number | null; recommendation: string | null;
  approver_id: number | null; approver_name: string | null;
  submitted_at: string | null; decided_at: string | null; decision_notes: string | null;
  created_by: number | null; created_by_name: string | null;
  team_count: number; team_lead: string | null;
  meeting_count: number; existing_client_count: number;
  actual_cost_inr: number | null;
}

export interface UserOpt { id: number; name: string; role: string }

// Status sorts along the exhibition's own run — Draft through Closed — because
// that sequence is what the column means. EXHIBITION_STATUSES already holds it.
const COLS: SortableColumn<ExhibitionRow>[] = [
  { key: 'name',   kind: 'text',   value: r => r.name },
  { key: 'when',   kind: 'date',   value: r => r.start_date },
  { key: 'where',  kind: 'text',   value: r => r.city },
  { key: 'status', kind: 'status', order: EXHIBITION_STATUSES, value: r => r.status },
  { key: 'team',   kind: 'number', value: r => r.team_count },
  { key: 'met',    kind: 'number', value: r => r.meeting_count },
  { key: 'budget', kind: 'number', value: r => r.estimated_cost_inr },
  { key: 'spend',  kind: 'number', value: r => r.actual_cost_inr },
];

export function ExhibitionsClient({ rows, users, me }: {
  rows: ExhibitionRow[];
  users: UserOpt[];
  me: { id: number | null; role: string };
}) {
  const router = useRouter();
  // Proposing an exhibition is an admin act. Checked inline rather than through
  // hasRole, which lives beside the server-only auth helpers and would pull them
  // into the browser bundle. createExhibition enforces the same rule server-side;
  // this only decides whether the button is worth showing.
  const canCreate = me.role === 'admin' || me.role === 'sysadmin';
  const [status, setStatus] = useState<string>('open');
  const [term, setTerm]     = useState('');
  const [open, setOpen]     = useState(false);

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return rows.filter(r => {
      if (status === 'open' && !OPEN_STATUSES.includes(r.status)) return false;
      if (status !== 'open' && status !== 'all' && r.status !== status) return false;
      if (!t) return true;
      return [r.name, r.city, r.venue, r.organizer, r.industry]
        .some(v => (v ?? '').toLowerCase().includes(t));
    });
  }, [rows, status, term]);

  // Every exhibition the user may see is already here — the filter above only
  // narrows it — so the sort runs in memory over the whole filtered set.
  const { rows: ordered, sortBy } = useTableSort(shown, COLS);

  const kpi = useMemo(() => {
    const awaiting = rows.filter(r => r.status === 'Submitted').length;
    const approved = rows.filter(r => r.status === 'Approved').length;
    const ongoing  = rows.filter(r => r.status === 'Ongoing').length;
    const spend    = rows.reduce((s, r) => s + Number(r.actual_cost_inr ?? 0), 0);
    const budget   = rows.reduce((s, r) => s + Number(r.estimated_cost_inr ?? 0), 0);
    const met      = rows.reduce((s, r) => s + Number(r.meeting_count ?? 0), 0);
    const known    = rows.reduce((s, r) => s + Number(r.existing_client_count ?? 0), 0);
    return { awaiting, approved, ongoing, spend, budget, met, known };
  }, [rows]);

  return (
    <div style={{ padding: '20px 24px 40px' }}>
      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Kpi label="Exhibitions"        value={String(rows.length)} sub={`${kpi.ongoing} ongoing`} />
        <Kpi label="Awaiting decision"  value={String(kpi.awaiting)} sub="submitted for approval" accent={kpi.awaiting > 0} />
        <Kpi label="Approved"           value={String(kpi.approved)} sub="cleared to attend" />
        <Kpi label="Budgeted"           value={fmtInr(kpi.budget)} sub="estimated cost" />
        <Kpi label="Actual spend"       value={fmtInr(kpi.spend)} sub={kpi.budget > 0 ? `${Math.round((kpi.spend / kpi.budget) * 100)}% of budget` : 'no budget set'} />
        <Kpi label="Companies met"      value={String(kpi.met)} sub={`${kpi.known} already clients`} />
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={status} onChange={e => setStatus(e.target.value)} style={SELECT}>
          <option value="open">Active only</option>
          <option value="all">All statuses</option>
          {EXHIBITION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          value={term} onChange={e => setTerm(e.target.value)}
          placeholder="Search name, city, venue, organizer…"
          aria-label="Search exhibitions"
          style={{ ...INPUT, width: 300 }}
        />
        <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
          {shown.length} of {rows.length}
        </span>
        {canCreate && (
          <button onClick={() => setOpen(true)} style={{ ...BTN_PRIMARY, marginLeft: 'auto' }}>
            + New Exhibition
          </button>
        )}
      </div>

      {/* List */}
      {shown.length === 0 ? (
        <Empty hasAny={rows.length > 0} onCreate={() => setOpen(true)} canCreate={canCreate} />
      ) : (
        <div style={PANEL}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <SortTH {...sortBy('name')}   style={TH}>Exhibition</SortTH>
                <SortTH {...sortBy('when')}   style={TH}>When</SortTH>
                <SortTH {...sortBy('where')}  style={TH}>Where</SortTH>
                <SortTH {...sortBy('status')} style={TH}>Status</SortTH>
                <SortTH {...sortBy('team')}   style={TH}>Team</SortTH>
                <SortTH {...sortBy('met')}    style={TH}>Met</SortTH>
                <SortTH {...sortBy('budget')} style={TH}>Budget</SortTH>
                <SortTH {...sortBy('spend')}  style={TH}>Spend</SortTH>
              </tr>
            </thead>
            <tbody>
              {ordered.map(r => {
                const days = eventDays(r.start_date, r.end_date);
                return (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/risansi/exhibitions/${r.id}`)}
                    style={{ cursor: 'pointer', borderTop: '1px solid var(--line)' }}
                    className="risansi-row"
                  >
                    <td style={TD}>
                      <div style={{ fontWeight: 600, color: 'var(--title)' }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                        {r.organizer || '—'}{r.industry ? ` · ${r.industry}` : ''}
                      </div>
                    </td>
                    <td style={TD}>
                      {r.start_date ? (
                        <>
                          <div>{r.start_date}</div>
                          <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                            {days ? `${days} day${days > 1 ? 's' : ''}` : ''}
                          </div>
                        </>
                      ) : <span style={{ color: 'var(--fg-3)' }}>—</span>}
                    </td>
                    <td style={TD}>
                      <div>{r.city || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{r.venue || ''}</div>
                    </td>
                    <td style={TD}>
                      <StatusChip status={r.status} />
                      {r.participation && (
                        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{r.participation}</div>
                      )}
                    </td>
                    <td style={TD}>
                      {r.team_count > 0
                        ? <><div>{r.team_count}</div><div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{r.team_lead ?? ''}</div></>
                        : <span style={{ color: 'var(--fg-3)' }}>—</span>}
                    </td>
                    <td style={TD}>
                      <div>{r.meeting_count}</div>
                      {r.existing_client_count > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--pos-strong)' }}>
                          {r.existing_client_count} existing
                        </div>
                      )}
                    </td>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{fmtInr(r.estimated_cost_inr)}</td>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{fmtInr(r.actual_cost_inr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <NewExhibitionModal
          users={users}
          defaultApprover={me.id}
          onClose={() => setOpen(false)}
          onCreated={id => { setOpen(false); router.push(`/risansi/exhibitions/${id}`); }}
        />
      )}
    </div>
  );
}

// ── New exhibition ───────────────────────────────────────────────

function NewExhibitionModal({ users, defaultApprover, onClose, onCreated }: {
  users: UserOpt[]; defaultApprover: number | null;
  onClose: () => void; onCreated: (id: number) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Only admin+ appear as approver options — the decision gate is the nominated
  // approver or a sysadmin, so offering anyone else would create an exhibition
  // that nobody is able to approve.
  const approvers = users.filter(u => u.role === 'admin' || u.role === 'sysadmin');

  async function handle(fd: FormData) {
    setSaving(true); setError('');
    try {
      // "Exhibition name is required.", "End date cannot be before the start
      // date." and the attending-window rules come back as refusals now, so the
      // modal stays open showing which field to fix.
      const res = await createExhibition(fd);
      if (!res.ok) { setError(res.error); setSaving(false); return; }
      onCreated(res.id);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      const redacted = !raw || /unexpected response/i.test(raw) || Boolean((err as { digest?: string })?.digest);
      setError(redacted ? 'Could not create the exhibition. Please check the fields and try again.' : raw);
      setSaving(false);
    }
  }

  return (
    <>
      <div onClick={onClose} style={BACKDROP} />
      <div className="risansi-modal" style={MODAL} role="dialog" aria-modal="true" aria-label="New exhibition">
        <div style={MODAL_HEAD}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>New Exhibition</span>
          <button onClick={onClose} aria-label="Close" style={X_BTN}>×</button>
        </div>
        <form action={handle} style={{ padding: 20, maxHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Exhibition name *">
              <input name="name" required style={INPUT} placeholder="e.g. India Sugar Expo 2027" />
            </Field>

            <Row>
              <Field label="Organizer"><input name="organizer" style={INPUT} /></Field>
              <Field label="Website"><input name="website" style={INPUT} placeholder="https://…" /></Field>
            </Row>

            <Row>
              <Field label="Start date"><input name="start_date" type="date" style={INPUT} /></Field>
              <Field label="End date"><input name="end_date" type="date" style={INPUT} /></Field>
            </Row>

            {/* The exhibition runs for its own dates; Risansi may be at the
                stand for only part of that, and team members pick their days
                from this window. Blank means the whole run. */}
            <Row>
              <Field label="Risansi attending from"><input name="attend_from" type="date" style={INPUT} /></Field>
              <Field label="Risansi attending to"><input name="attend_to" type="date" style={INPUT} /></Field>
            </Row>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: -4, marginBottom: 8 }}>
              Leave blank to attend the whole run. Team members are then assigned
              individual days out of this window, and only those days block their calendar.
            </div>

            <Row>
              <Field label="Venue"><input name="venue" style={INPUT} /></Field>
              <Field label="City"><input name="city" style={INPUT} /></Field>
            </Row>

            <Row>
              <Field label="State"><input name="state" style={INPUT} /></Field>
              <Field label="Country"><input name="country" defaultValue="India" style={INPUT} /></Field>
            </Row>

            <Row>
              <Field label="Industry"><input name="industry" style={INPUT} placeholder="e.g. Sugar" /></Field>
              <Field label="How was it found?">
                <select name="source" defaultValue="" style={INPUT}>
                  <option value="">— Select —</option>
                  {DISCOVERY_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </Row>

            <Row>
              <Field label="Suggested participation">
                <select name="suggested" defaultValue="" style={INPUT}>
                  <option value="">— Select —</option>
                  {PARTICIPATION.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Estimated cost (₹)" hint="Rupees, e.g. 5,00,000">
                <input name="estimated_cost_inr" inputMode="decimal" style={INPUT} placeholder="5,00,000" />
              </Field>
            </Row>

            <Field label="Approver" hint="Who signs this off. Only they (or a sysadmin) can decide.">
              <select name="approver_id" defaultValue={defaultApprover ?? ''} style={INPUT}>
                <option value="">— Select —</option>
                {approvers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>

            <Field label="Why attend?">
              <textarea name="recommendation" rows={3} style={{ ...INPUT, resize: 'vertical' }}
                placeholder="Relevance, expected footfall, who we would meet…" />
            </Field>

            {error && <div style={ERR}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={BTN_GHOST}>Cancel</button>
              <button type="submit" disabled={saving} style={{ ...BTN_PRIMARY, opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}

// ── Small pieces ─────────────────────────────────────────────────

export function StatusChip({ status }: { status: ExhibitionStatus }) {
  const tone = STATUS_TONE[status] ?? { bg: 'var(--bg-elev)', fg: 'var(--fg-2)' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11,
      fontWeight: 600, background: tone.bg, color: tone.fg,
    }}>{status}</span>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ ...PANEL, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 22, marginTop: 4,
        color: accent ? 'var(--title)' : 'var(--fg)',
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Empty({ hasAny, onCreate, canCreate }: { hasAny: boolean; onCreate: () => void; canCreate: boolean }) {
  return (
    <div style={{ ...PANEL, padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: 'var(--fg-2)', marginBottom: 6 }}>
        {hasAny ? 'No exhibitions match this filter.' : 'No exhibitions yet.'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 16 }}>
        {hasAny ? 'Try “All statuses”, or clear the search.'
          : canCreate ? 'Add the first event you are considering.'
          : 'You will see an exhibition here once you are added to its team.'}
      </div>
      {!hasAny && canCreate && <button onClick={onCreate} style={BTN_PRIMARY}>+ New Exhibition</button>}
    </div>
  );
}

// Columns follow the width. A fixed '1fr 1fr' ignores the container entirely,
// so widening the shell produced wider fields and exactly the same number of
// rows — which is not what "less scrolling" means. With auto-fit a row given
// three fields lays them out three-across when there is room, and a narrow
// container gets one clean column instead of two cramped ones.
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>{children}</div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={LABEL}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>{hint}</p>}
    </div>
  );
}

// ── Styles (tokens only — both themes) ───────────────────────────

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 8, overflow: 'hidden',
};
const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase',
  letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)',
  borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
};
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
const INPUT: CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)',
  borderRadius: 6, fontSize: 13, background: 'var(--bg-paper)', color: 'var(--fg)',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
const SELECT: CSSProperties = { ...INPUT, width: 'auto', minWidth: 150 };
const LABEL: CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase',
  letterSpacing: '0.06em', display: 'block', marginBottom: 5,
};
const BTN_PRIMARY: CSSProperties = {
  padding: '8px 16px', borderRadius: 6, background: 'var(--accent-fill)', color: 'var(--on-accent)',
  border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
};
const BTN_GHOST: CSSProperties = {
  padding: '8px 16px', borderRadius: 6, border: '1px solid var(--line-strong)',
  background: 'var(--bg-paper)', color: 'var(--fg-2)', cursor: 'pointer',
  fontSize: 13, fontFamily: 'inherit',
};
const BACKDROP: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 300 };
const MODAL: CSSProperties = {
  position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
  width: 780, maxWidth: 'calc(100vw - 32px)', background: 'var(--bg-paper)',
  borderRadius: 12, zIndex: 301, boxShadow: '0 20px 60px rgba(10,22,40,0.25)', overflow: 'hidden',
};
const MODAL_HEAD: CSSProperties = {
  padding: '16px 20px', borderBottom: '1px solid var(--line)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
};
const X_BTN: CSSProperties = {
  background: 'none', border: 'none', fontSize: 20, cursor: 'pointer',
  color: 'var(--fg-3)', lineHeight: 1,
};
const ERR: CSSProperties = {
  padding: '8px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)',
  borderLeft: '3px solid var(--neg)', borderRadius: 5, color: 'var(--neg-strong)', fontSize: 12,
};
