'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { convertMeetingToLead, skipMeetingLead, reopenMeetingLead } from '@/app/actions/risansi-exhibitions';
import { ClientFormDrawer } from './ClientFormDrawer';

// The companies the reps marked as worth pursuing, and what the review did
// about each.
//
// The mark is made at the stand and nobody is told; this is where it is read.
// Only the person running the review acts on it — they either open the client
// form, pre-filled from the meeting, and create a Prospective-Lead with a
// Suspect opportunity for the potential value, or set it aside with a reason.
// The exhibition cannot close while one is neither (closeReadiness).

export interface PotentialMeeting {
  id: number;
  company_name: string;
  contact_person: string | null;
  designation: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  requirement: string | null;
  interest: string | null;
  potential_value_inr: number | null;
  met_by_name: string | null;
  met_on: string | null;
  /** Matched to an existing client at the stand — nothing to create. */
  client_id: number | null;
  client_code: string | null;
  client_legal_name: string | null;
  /** What the review decided. */
  lead_client_id: number | null;
  lead_client_code: string | null;
  lead_opportunity_id: number | null;
  lead_skipped_reason: string | null;
}

const inr = (n: number | null) => (n == null ? null : `₹${Math.round(n).toLocaleString('en-IN')}`);

export function PotentialLeads({ exhibitionId, meetings, editable }: {
  exhibitionId: number; meetings: PotentialMeeting[]; editable: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState<PotentialMeeting | null>(null);
  const [skipping, setSkipping] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();

  if (!meetings.length) return null;
  const undecided = meetings.filter(m => m.client_id == null && m.lead_client_id == null && !m.lead_skipped_reason);

  const skip = (id: number) => start(async () => {
    setErr('');
    try {
      // A blank reason, or a meeting that already became a lead, comes back as
      // a sentence now — the reason box stays open with it underneath.
      const res = await skipMeetingLead(exhibitionId, id, reason);
      if (!res.ok) { setErr(res.error); return; }
      setSkipping(null); setReason(''); router.refresh();
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); }
  });
  const reopen = (id: number) => start(async () => {
    setErr('');
    try {
      // Only the reviewer may undo a set-aside, and not once the exhibition is
      // closed. Both come back as a sentence, like skipMeetingLead's do.
      const res = await reopenMeetingLead(exhibitionId, id);
      if (!res.ok) { setErr(res.error); return; }
      router.refresh();
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not reopen.'); }
  });

  return (
    <div style={{ ...PANEL, borderColor: undecided.length ? 'var(--warn)' : 'var(--line)' }}>
      <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: undecided.length ? 'var(--warn-soft)' : 'var(--bg-elev)' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>⭐ Marked high potential</span>
        <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
          {meetings.length} marked · {meetings.filter(m => m.lead_client_id).length} made a lead
          {undecided.length ? ` · ${undecided.length} still to decide` : ' · all decided'}
        </span>
      </div>
      <div>
        {meetings.map((m, i) => {
          const already = m.client_id != null;
          const made = m.lead_client_id != null;
          const setAside = !!m.lead_skipped_reason;
          return (
            <div key={m.id} className="pl-row" style={{ padding: '11px 14px', borderBottom: i < meetings.length - 1 ? '1px solid var(--line)' : 'none', display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{m.company_name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                  {[m.contact_person && `${m.contact_person}${m.designation ? `, ${m.designation}` : ''}`, m.city, m.phone, m.email].filter(Boolean).join(' · ') || 'No contact details captured'}
                </div>
                {m.requirement && <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginTop: 4 }}>{m.requirement}</div>}
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
                  {[m.interest && `${m.interest} interest`, inr(m.potential_value_inr) && `potential ${inr(m.potential_value_inr)}`, m.met_by_name && `met by ${m.met_by_name}`, m.met_on?.slice(0, 10)].filter(Boolean).join(' · ')}
                </div>
              </div>

              <div className="pl-actions" style={{ minWidth: 210, textAlign: 'right' }}>
                {already ? (
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                    Already a client — <a href={`/risansi/clients/${m.client_id}`} style={LINK}>{m.client_legal_name ?? m.client_code}</a>
                    <div style={{ marginTop: 2 }}>Raise an opportunity on the account.</div>
                  </div>
                ) : made ? (
                  <div style={{ fontSize: 11.5, color: 'var(--pos)' }}>
                    ✓ Lead created — <a href={`/risansi/clients/${m.lead_client_id}`} style={LINK}>{m.lead_client_code ?? 'open client'}</a>
                    {m.lead_opportunity_id && <div style={{ color: 'var(--fg-3)', marginTop: 2 }}>with a Suspect opportunity</div>}
                  </div>
                ) : setAside ? (
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                    Set aside — {m.lead_skipped_reason}
                    {editable && <button type="button" onClick={() => reopen(m.id)} disabled={pending} style={{ ...GHOST, marginTop: 6 }}>Decide again</button>}
                  </div>
                ) : skipping === m.id ? (
                  <div style={{ textAlign: 'left' }}>
                    <input value={reason} onChange={e => setReason(e.target.value)} autoFocus
                      placeholder="Why not now? e.g. no budget this year" style={INPUT} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                      <button type="button" onClick={() => { setSkipping(null); setReason(''); }} style={GHOST}>Cancel</button>
                      <button type="button" onClick={() => skip(m.id)} disabled={pending || !reason.trim()} style={{ ...PRIMARY, opacity: reason.trim() ? 1 : 0.5 }}>Set aside</button>
                    </div>
                  </div>
                ) : editable ? (
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => { setSkipping(m.id); setReason(''); }} style={GHOST}>Not now</button>
                    <button type="button" onClick={() => setCreating(m)} style={PRIMARY}>Create lead →</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: 'var(--warn-strong, var(--warn))' }}>Waiting on the review</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {err && <div style={{ padding: '8px 14px', color: 'var(--neg)', fontSize: 12 }}>{err}</div>}

      {/* The Client Master's own form, opened with the meeting in it. */}
      {creating && (
        <ClientFormDrawer
          // Keyed on the meeting, for the same reason UserDrawer is keyed on
          // the user: the form seeds ~20 fields with defaultValue at mount.
          key={`lead-${creating.id}`}
          mode="create"
          title={`New lead — ${creating.company_name}`}
          client={{
            legal_name: creating.company_name,
            city: creating.city,
            country: 'India',
            contact_person: creating.contact_person,
            designation: creating.designation,
            phone: creating.phone,
            email: creating.email,
          }}
          // The action returns its refusals now. Re-thrown here rather than
          // passed on, because the drawer's own catch is what prints a message
          // under its Create button — and a refusal raised on this side of the
          // boundary reaches it intact instead of being redacted.
          submit={async fd => {
            const res = await convertMeetingToLead(exhibitionId, creating.id, fd);
            if (!res.ok) throw new Error(res.error);
          }}
          onClose={() => { setCreating(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 12 };
const LINK: CSSProperties = { color: 'var(--brand-blue, #1A5CB8)', textDecoration: 'none', fontWeight: 600 };
const INPUT: CSSProperties = { width: 240, maxWidth: '100%', padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-paper)', color: 'var(--fg)', boxSizing: 'border-box' };
const GHOST: CSSProperties = { padding: '6px 11px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-paper)', color: 'var(--fg-2)', cursor: 'pointer' };
const PRIMARY: CSSProperties = { padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', border: 'none', borderRadius: 6, background: 'var(--accent-fill)', color: 'var(--on-accent)', cursor: 'pointer' };
