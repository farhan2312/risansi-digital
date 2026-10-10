'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { fmtInr, fmtInrFull, INTEREST_LEVELS, type ExhibitionStatus } from '@/lib/risansi-exhibition-fields';
import {
  updateMeetingCompany, setMeetingFollowUp, convertMeetingToLead,
  reviewExhibitionExpenses, closeExhibition, reopenExhibition, saveExhibitionReview,
  type FollowUpType,
} from '@/app/actions/risansi-exhibitions';
import type { MeetingRow, MeetingContactRow, ExpenseRow, ReviewRow } from './ExhibitionDetail';
import { PotentialLeads } from './PotentialLeads';
import type { UserOpt } from './ExhibitionsClient';
import { useTableSort, SortTH } from './SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';
import { CLIENT_TYPES } from '@/lib/risansi-client-types';
import { INDIAN_STATES } from '@/lib/risansi-geo';
import { countryGroupsWith } from '@/lib/risansi-geo-regions';
import { useCloseGuard, useDialogFocus, CloseX, CloseConfirm, KeepOpenHint } from './FormCloseGuard';

/**
 * The post-event review, worked meeting by meeting.
 *
 * Three things happen here and they happen in order: every meeting gets a
 * decision, the expenses get signed off, and then the exhibition is closed for
 * good. Only the person who proposed the exhibition may do it — they are the one
 * accountable for what it cost and what it produced.
 */

export interface ReviewMeeting extends MeetingRow {
  follow_up_type: FollowUpType | null;
  follow_up_owner_id: number | null;
  follow_up_owner_name: string | null;
  follow_up_note: string | null;
  linked_visit_id: number | null;
  linked_task_id: number | null;
  linked_opportunity_id: number | null;
  /** The high-potential mark and what the review decided about it. */
  lead_client_id: number | null;
  lead_client_code: string | null;
  lead_opportunity_id: number | null;
  lead_skipped_reason: string | null;
}

/**
 * What the review can decide about a meeting.
 *
 * Four of these are follow_up_type values the meeting row stores. 'Lead' is not
 * one of them: converting writes a client, its contacts and an opportunity
 * through convertMeetingToLead, and leaves follow_up_type alone — so it is a
 * UI-level choice in the same dropdown rather than a fifth value the column
 * would have to accept.
 */
export type Disposition = FollowUpType | 'Lead';

const DISPOSITIONS: { value: Disposition; label: string; needsClient: boolean; hint: string }[] = [
  { value: 'None',        label: 'No follow-up needed', needsClient: false, hint: 'Closes this meeting off with no further work.' },
  { value: 'Visit',       label: 'Schedule a visit',    needsClient: true,  hint: 'Creates a planned visit in the Field calendar.' },
  { value: 'Action',      label: 'Assign an action',    needsClient: false, hint: 'Creates a task in their Action Registry.' },
  { value: 'Opportunity', label: 'Raise an opportunity', needsClient: true, hint: 'Creates a Suspect-stage opportunity in the pipeline.' },
  // needsClient is false on purpose: the whole point is that there is no client
  // yet. It is the one disposition that refuses a company already on the books.
  { value: 'Lead',        label: 'Convert to Prospective Lead', needsClient: false,
    hint: 'Creates a Prospective-Lead client with an auto LEAD_ code, every contact met, and a Suspect opportunity for the potential value.' },
];

/**
 * What the review produced for one meeting, as the Result column says it.
 * Shared with the sort so the column orders by the words on screen rather than
 * by the three id columns they are derived from.
 */
function resultLabel(m: ReviewMeeting): string | null {
  return m.linked_visit_id ? 'Visit planned'
    : m.linked_task_id ? 'Action assigned'
    : m.linked_opportunity_id ? 'Opportunity raised'
    : m.follow_up_type === 'None' ? 'No follow-up'
    : null;
}

// Interest runs Hot → Warm → Cold, and the follow-up runs down the list of
// dispositions the review offers; neither is alphabetical, and both lists are
// already declared above / in the exhibition fields module.
const MEETING_COLS: SortableColumn<ReviewMeeting>[] = [
  { key: 'company',   kind: 'text',   value: m => m.company_name },
  { key: 'contact',   kind: 'text',   value: m => m.contact_person },
  { key: 'interest',  kind: 'status', order: INTEREST_LEVELS, value: m => m.interest },
  { key: 'potential', kind: 'number', value: m => m.potential_value_inr },
  { key: 'followup',  kind: 'status', order: DISPOSITIONS.map(d => d.value), value: m => m.follow_up_type },
  { key: 'owner',     kind: 'text',   value: m => m.follow_up_owner_name },
  { key: 'result',    kind: 'text',   value: resultLabel },
];

export function ExhibitionReviewWorkbench({
  exhibitionId, status, meetings, expenses, users,
  expensesReviewedAt, closedAt, closedByName, isOwner, isSysadmin, blockers, hasReview, review,
}: {
  exhibitionId: number; status: ExhibitionStatus;
  meetings: ReviewMeeting[]; expenses: ExpenseRow[]; users: UserOpt[];
  expensesReviewedAt: string | null; closedAt: string | null; closedByName: string | null;
  isOwner: boolean; isSysadmin: boolean; blockers: string[]; hasReview: boolean;
  review: ReviewRow | null;
}) {
  const closed = status === 'Closed';
  const decided = meetings.filter(m => m.follow_up_type != null).length;
  // Every meeting captured at the event is on this page; the table is not a
  // window onto a longer query, so the sort runs here over all of them.
  const { rows: ordered, sortBy } = useTableSort(meetings, MEETING_COLS);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {closed && <ClosedBanner closedAt={closedAt} closedByName={closedByName}
        exhibitionId={exhibitionId} isSysadmin={isSysadmin} />}

      {!isOwner && !closed && (
        <div style={{ ...NOTE, background: 'var(--bg-elev)', border: '1px solid var(--line)' }}>
          Only the person who proposed this exhibition can complete the review. You can read it here.
        </div>
      )}

      {/* Step 1 — meetings. The marked ones come first: they are the reason
          somebody walked a stand, and the review is where they become leads. */}
      <section>
        <PotentialLeads
          exhibitionId={exhibitionId}
          editable={isOwner && !closed}
          meetings={meetings.filter(m => m.high_potential).map(m => ({
            id: m.id, company_name: m.company_name, contact_person: m.contact_person, designation: m.designation,
            phone: m.phone, email: m.email, city: m.city, requirement: m.requirement, interest: m.interest,
            potential_value_inr: m.potential_value_inr, met_by_name: m.met_by_name, met_on: m.met_on,
            client_id: m.client_id, client_code: m.client_code, client_legal_name: m.client_legal_name,
            lead_client_id: m.lead_client_id, lead_client_code: m.lead_client_code,
            lead_opportunity_id: m.lead_opportunity_id, lead_skipped_reason: m.lead_skipped_reason,
          }))}
        />
        <StepHead n={1} title="Decide each meeting"
          done={meetings.length > 0 && decided === meetings.length}
          sub={`${decided} of ${meetings.length} decided`} />
        {meetings.length === 0 ? (
          <div style={PANEL}><div style={BLANK}>No meetings were captured at this exhibition.</div></div>
        ) : (
          <div style={PANEL}>
            <div style={{ overflowX: 'auto' }}>
              <table className="exh-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <SortTH {...sortBy('company')}   style={TH}>Company</SortTH>
                    <SortTH {...sortBy('contact')}   style={TH}>Contact</SortTH>
                    <SortTH {...sortBy('interest')}  style={TH}>Interest</SortTH>
                    <SortTH {...sortBy('potential')} style={TH}>Potential</SortTH>
                    <SortTH {...sortBy('followup')}  style={TH}>Follow-up</SortTH>
                    <SortTH {...sortBy('owner')}     style={TH}>Assigned to</SortTH>
                    <SortTH {...sortBy('result')}    style={TH}>Result</SortTH>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map(m => (
                    <MeetingReviewRow key={m.id} exhibitionId={exhibitionId} meeting={m}
                      users={users} editable={isOwner && !closed} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Step 2 — expenses */}
      <section>
        <StepHead n={2} title="Sign off the expenses" done={!!expensesReviewedAt}
          sub={expensesReviewedAt ? `Signed off ${expensesReviewedAt.slice(0, 10)}` : `${expenses.length} line(s)`} />
        <ExpenseSignOff exhibitionId={exhibitionId} expenses={expenses}
          reviewedAt={expensesReviewedAt} editable={isOwner && !closed} />
      </section>

      {/* Step 3 — the summary, last because it summarises the two steps above */}
      <section>
        <StepHead n={3} title="Final summary" done={hasReview}
          sub={hasReview ? 'Saved' : 'Pre-filled from the records above'} />
        <SummaryForm exhibitionId={exhibitionId} review={review} meetings={meetings}
          editable={isOwner && !closed} />
      </section>

      {/* Step 4 — close */}
      <section>
        <StepHead n={4} title="Close the exhibition" done={closed}
          sub={closed ? 'Closed — read only' : 'Locks everything for good'} />
        <ClosePanel exhibitionId={exhibitionId} blockers={blockers} hasReview={hasReview}
          closed={closed} editable={isOwner && !closed} />
      </section>
    </div>
  );
}

// ── One meeting ──────────────────────────────────────────────────

function MeetingReviewRow({ exhibitionId, meeting: m, users, editable }: {
  exhibitionId: number; meeting: ReviewMeeting; users: UserOpt[]; editable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [type, setType] = useState<Disposition>(m.follow_up_type ?? 'None');
  const [owner, setOwner] = useState<string>(m.follow_up_owner_id ? String(m.follow_up_owner_id) : '');
  const [due, setDue]   = useState(m.follow_up_date ?? '');
  const [note, setNote] = useState(m.follow_up_note ?? '');
  const [value, setValue] = useState(m.potential_value_inr != null ? String(m.potential_value_inr) : '');
  const [leadDraft, setLeadDraft] = useState<LeadDraft>(() => newLeadDraft(m));

  const def = DISPOSITIONS.find(d => d.value === type)!;
  const blockedNoClient = def.needsClient && m.client_id == null;
  // Converting is the one disposition refused for a company already on the
  // books, and the reason is said here rather than only on the failed save.
  const leadBlocked = type === 'Lead' ? leadBlockedReason(m) : null;
  const isLead = type === 'Lead';

  // The fields above are seeded once, at mount, and this row stays mounted for
  // as long as the table does — so after a save, a refresh, or somebody else
  // editing the same meeting, they would still hold whatever was last typed
  // here. Re-seeding on every open means the editor always opens on what the
  // row actually says. (The same mistake, made across rows instead of across
  // opens, is what put one company's details in another company's edit form on
  // the Meetings tab.)
  function openEditor() {
    setType(m.follow_up_type ?? 'None');
    setOwner(m.follow_up_owner_id ? String(m.follow_up_owner_id) : '');
    setDue(m.follow_up_date ?? '');
    setNote(m.follow_up_note ?? '');
    setValue(m.potential_value_inr != null ? String(m.potential_value_inr) : '');
    setLeadDraft(newLeadDraft(m));
    setErr('');
    setOpen(true);
  }

  async function save() {
    // Converting is not a follow_up_type, so it takes its own route: the client
    // form's fields, and the action that writes a client, its contacts and an
    // opportunity rather than a row on the meeting.
    if (type === 'Lead') {
      const problem = leadBlocked ?? leadDraftProblem(leadDraft);
      if (problem) { setErr(problem); return; }
      setBusy(true); setErr('');
      try {
        const res = await convertMeetingToLead(exhibitionId, m.id, leadFormData(leadDraft));
        if (!res.ok) { setErr(res.error); return; }
        setOpen(false); router.refresh();
      } catch (e) {
        const raw = e instanceof Error ? e.message : '';
        const redacted = !raw || /unexpected response|Server Components render/i.test(raw)
          || Boolean((e as { digest?: string })?.digest);
        setErr(redacted ? 'Could not create the lead.' : raw);
      } finally { setBusy(false); }
      return;
    }
    setBusy(true); setErr('');
    try {
      const res = await setMeetingFollowUp(exhibitionId, m.id, {
        type, ownerId: owner ? Number(owner) : null,
        dueDate: due || null, note: note || null,
        valueInr: value ? Number(String(value).replace(/[₹,\s]/g, '')) : null,
      });
      if (!res.ok) { setErr(res.error); return; }
      setOpen(false); router.refresh();
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const redacted = !raw || /unexpected response|Server Components render/i.test(raw)
        || Boolean((e as { digest?: string })?.digest);
      setErr(redacted ? 'Could not save this follow-up.' : raw);
    } finally { setBusy(false); }
  }

  const result = resultLabel(m);

  return (
    <>
      <tr style={{ borderTop: '1px solid var(--line)' }}>
        <td data-label="Company" style={{ ...TD, minWidth: 200 }}>
          <CompanyCell exhibitionId={exhibitionId} meeting={m} editable={editable} />
        </td>
        <td data-label="Contact"  style={TD}>{m.contact_person || '—'}</td>
        <td data-label="Interest" style={TD}>{m.interest || '—'}</td>
        <td data-label="Potential" style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{fmtInr(m.potential_value_inr)}</td>
        <td data-label="Follow-up" style={TD}>
          {m.follow_up_type
            ? <span style={{ fontWeight: 600 }}>{DISPOSITIONS.find(d => d.value === m.follow_up_type)?.label ?? m.follow_up_type}</span>
            : <span style={{ color: 'var(--neg)' }}>Not decided</span>}
        </td>
        <td data-label="Assigned to" style={TD}>{m.follow_up_owner_name || '—'}</td>
        <td data-label="Result" style={TD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {result && <span style={DONE_PILL}>{result}</span>}
            {/* A lead is a separate fact from the follow-up — a meeting can have
                both — so it gets its own pill rather than replacing the other. */}
            {m.lead_client_id != null && (
              <a href={`/risansi/clients/${m.lead_client_id}`} style={{ ...KNOWN_PILL, textDecoration: 'none' }}>
                ✓ Lead{m.lead_client_code ? ` · ${m.lead_client_code}` : ''}
              </a>
            )}
            {editable && (
              <button onClick={() => (open ? setOpen(false) : openEditor())} style={LINK_BTN}>
                {open ? 'Close' : m.follow_up_type ? 'Change' : 'Decide'}
              </button>
            )}
          </div>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={7} style={{ padding: 0 }}>
            <div style={{ padding: 14, background: 'var(--bg-elev)', borderTop: '1px solid var(--line)' }}>
              <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={LABEL}>What happens next</label>
                  <select value={type} onChange={e => { setType(e.target.value as FollowUpType); setErr(''); }} style={INPUT}>
                    {DISPOSITIONS.map(d => (
                      <option key={d.value} value={d.value}
                        disabled={d.needsClient && m.client_id == null}>
                        {d.label}{d.needsClient && m.client_id == null ? ' — needs a known client' : ''}
                      </option>
                    ))}
                  </select>
                  <p style={HINT}>{def.hint}</p>
                </div>
                {/* Converting picks its owner inside the client fields below —
                    a lead's primary rep is an attribute of the client, not an
                    assignment — so this select would be a second one for the
                    same question. */}
                {type !== 'None' && !isLead && (
                  <div>
                    <label style={LABEL}>Assign to</label>
                    <select value={owner} onChange={e => setOwner(e.target.value)} style={INPUT}>
                      <option value="">— Select —</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {isLead && (
                <>
                  {leadBlocked && <div style={{ ...ERR, marginTop: 10 }}>{leadBlocked}</div>}
                  {!leadBlocked && (
                    <LeadFields draft={leadDraft} users={users} contacts={m.contacts ?? []}
                      onChange={p => setLeadDraft(d => ({ ...d, ...p }))} />
                  )}
                </>
              )}

              {(type === 'Visit' || type === 'Action') && (
                <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                  <div>
                    <label style={LABEL}>{type === 'Visit' ? 'Visit date' : 'Due date'}</label>
                    <input type="date" value={due} onChange={e => setDue(e.target.value)} style={INPUT} />
                  </div>
                  <div>
                    <label style={LABEL}>{type === 'Action' ? 'What to do' : 'Note'}</label>
                    <input value={note} onChange={e => setNote(e.target.value)} style={INPUT}
                      placeholder={type === 'Action' ? 'e.g. Send the spares quotation' : 'Optional'} />
                  </div>
                </div>
              )}

              {type === 'Opportunity' && (
                <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                  <div>
                    <label style={LABEL}>What they want</label>
                    <input value={note} onChange={e => setNote(e.target.value)} style={INPUT}
                      placeholder="e.g. 2 × PCP for molasses" />
                  </div>
                  <div>
                    <label style={LABEL}>Estimated value (₹)</label>
                    <input value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" style={INPUT} />
                    <p style={HINT}>Starts at Suspect — a stand conversation is a lead, not a quotation.</p>
                  </div>
                </div>
              )}

              {blockedNoClient && (
                <div style={{ ...ERR, marginTop: 10 }}>
                  {m.company_name} is not in the client master, so a {type.toLowerCase()} cannot be raised.
                  Correct the company name above until it matches, or assign an action instead.
                </div>
              )}
              {err && <div style={{ ...ERR, marginTop: 10 }}>{err}</div>}

              {(() => {
                // Converting asks for an owner inside the client fields, where
                // blank is a valid answer, so the "pick who" rule is not its rule.
                const stop = isLead
                  ? !!leadBlocked
                  : blockedNoClient || (type !== 'None' && !owner);
                return (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                    <button onClick={() => setOpen(false)} style={BTN_GHOST}>Cancel</button>
                    <button onClick={save} disabled={busy || stop}
                      style={{ ...BTN_PRIMARY, opacity: busy || stop ? 0.55 : 1 }}>
                      {busy ? (isLead ? 'Creating…' : 'Saving…')
                        : isLead ? 'Create Prospective Lead' : 'Save follow-up'}
                    </button>
                  </div>
                );
              })()}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The company name, correctable here. A name typed badly at a stand is also a
 * missed match, so fixing it is the moment the meeting can finally be linked to
 * the client it always belonged to — which is what unlocks a visit or an
 * opportunity for it.
 */
function CompanyCell({ exhibitionId, meeting: m, editable }: {
  exhibitionId: number; meeting: ReviewMeeting; editable: boolean;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(m.company_name);
  const [clientId, setClientId] = useState<number | null>(m.client_id);
  const [matched, setMatched] = useState<string | null>(m.client_code);
  const [hits, setHits] = useState<Array<{ id: number; code: string | null; legal_name: string; city: string | null; exact: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!edit) return;
    if (timer.current) clearTimeout(timer.current);
    const q = name.trim();
    if (q.length < 2) { setHits([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/risansi/exhibitions/client-lookup?q=${encodeURIComponent(q)}`);
        if (!res.ok) { setHits([]); return; }
        const d = await res.json();
        setHits(Array.isArray(d.matches) ? d.matches : []);
      } catch { setHits([]); }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [name, edit]);

  async function save() {
    setBusy(true); setErr('');
    try {
      // A blank name comes back as a refusal now, so the editor stays open with
      // the reason under the input instead of closing on a redacted digest.
      const res = await updateMeetingCompany(exhibitionId, m.id, name, clientId);
      if (!res.ok) { setErr(res.error); return; }
      setEdit(false); router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  }

  if (!edit) {
    return (
      <div>
        <div style={{ fontWeight: 600, color: 'var(--title)' }}>{m.company_name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
          {m.client_id != null
            ? <span style={KNOWN_PILL}>✓ {m.client_code ?? 'client'}</span>
            : <span style={NEW_PILL}>not in client master</span>}
          {/* Seeded from the row on every open, not once at mount — same reason
              as the follow-up editor above. */}
          {editable && (
            <button style={LINK_BTN} onClick={() => {
              setName(m.company_name); setClientId(m.client_id); setMatched(m.client_code);
              setHits([]); setErr(''); setEdit(true);
            }}>rename</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <input value={name} onChange={e => { setName(e.target.value); setClientId(null); setMatched(null); }}
        style={{ ...INPUT, minWidth: 190 }} autoFocus aria-label="Company name" />
      {matched && <div style={{ marginTop: 4 }}><span style={KNOWN_PILL}>✓ linked · {matched}</span></div>}
      {!matched && hits.length > 0 && (
        <div style={{ marginTop: 4, maxHeight: 150, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
          {hits.slice(0, 5).map(h => (
            <button key={h.id} type="button"
              onClick={() => { setClientId(h.id); setMatched(h.code ?? h.legal_name); setName(h.legal_name); setHits([]); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px',
                       background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
              {h.legal_name}<span style={{ color: 'var(--fg-3)' }}>{h.code ? ` · ${h.code}` : ''}</span>
            </button>
          ))}
        </div>
      )}
      {err && <div style={{ ...ERR, marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button onClick={save} disabled={busy} style={{ ...BTN_PRIMARY, padding: '5px 10px', fontSize: 12 }}>
          {busy ? '…' : 'Save'}
        </button>
        <button onClick={() => { setEdit(false); setName(m.company_name); setClientId(m.client_id); setMatched(m.client_code); }}
          style={{ ...BTN_GHOST, padding: '5px 10px', fontSize: 12 }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Final summary ────────────────────────────────────────────────

/**
 * Sits last, because it summarises the two steps above it.
 *
 * The countable fields arrive already filled from the records themselves: leads
 * worth pursuing is how many meetings were given a real follow-up, opportunities
 * raised is how many actually became one, and potential business is the sum of
 * what was captured at the stand. Nobody should be re-counting rows they have
 * just finished working through — and a hand-typed count would be the number that
 * quietly disagrees with the table above it.
 *
 * Every prefilled value stays editable: the derived figure is a starting point,
 * not a verdict. Only what genuinely cannot be derived — business actually won,
 * footfall, and the written judgement — starts blank.
 */
function SummaryForm({ exhibitionId, review, meetings, editable }: {
  exhibitionId: number; review: ReviewRow | null; meetings: ReviewMeeting[]; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [edit, setEdit] = useState(!review);

  const derived = {
    // "Worth pursuing" = we decided to do something about it.
    newLeads: meetings.filter(m => m.follow_up_type && m.follow_up_type !== 'None').length,
    opportunities: meetings.filter(m => m.linked_opportunity_id != null).length,
    potential: meetings.reduce((s, m) => s + Number(m.potential_value_inr ?? 0), 0),
  };
  // A saved review wins over the derived figure — someone may have corrected it.
  const val = (saved: number | null | undefined, auto: number) =>
    saved != null ? String(saved) : auto ? String(auto) : '';

  if (!editable && !review) {
    return <div style={PANEL}><div style={BLANK}>The summary has not been filled in yet.</div></div>;
  }

  if (!edit && review) {
    return (
      <div style={{ ...PANEL, padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <Fig label="New leads"       v={review.new_leads?.toString() ?? '—'} />
          <Fig label="Opportunities"   v={review.opportunities?.toString() ?? '—'} />
          <Fig label="Potential"       v={review.potential_value_inr != null ? fmtInrFull(review.potential_value_inr) : '—'} />
          <Fig label="Business won"    v={review.business_won_inr != null ? fmtInrFull(review.business_won_inr) : '—'} />
          <Fig label="Footfall"        v={review.footfall?.toString() ?? '—'} />
          <Fig label="Attend next year" v={review.attend_next_year ?? '—'} />
        </div>
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          <Note k="Worked well"  v={review.what_worked} />
          <Note k="Did not work" v={review.what_did_not} />
          <Note k="Learnings"    v={review.key_learnings} />
          <Note k="Competitors"  v={review.competitor_notes} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 12 }}>
          Saved by {review.reviewed_by_name ?? '—'}{review.reviewed_at ? ` on ${review.reviewed_at.slice(0, 10)}` : ''}
        </div>
        {editable && <button onClick={() => setEdit(true)} style={{ ...BTN_GHOST, marginTop: 10 }}>Edit summary</button>}
      </div>
    );
  }

  return (
    <div style={{ ...PANEL, padding: 16 }}>
      <form className="exh-form" action={async fd => {
        setBusy(true); setErr('');
        try {
          const res = await saveExhibitionReview(exhibitionId, fd);
          if (!res.ok) { setErr(res.error); return; }
          setEdit(false); router.refresh();
        }
        catch (e) {
          const raw = e instanceof Error ? e.message : '';
          const redacted = !raw || /unexpected response|Server Components render/i.test(raw)
            || Boolean((e as { digest?: string })?.digest);
          setErr(redacted ? 'Could not save the summary.' : raw);
        } finally { setBusy(false); }
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            The counts below are filled in from the meetings and expenses you just worked through.
            Change any of them if you disagree.
          </div>

          <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Fld label="New leads worth pursuing" hint={`${derived.newLeads} meeting(s) given a follow-up`}>
              <input name="new_leads" inputMode="numeric" style={INPUT}
                defaultValue={val(review?.new_leads, derived.newLeads)} />
            </Fld>
            <Fld label="Opportunities raised" hint={`${derived.opportunities} raised from this review`}>
              <input name="opportunities" inputMode="numeric" style={INPUT}
                defaultValue={val(review?.opportunities, derived.opportunities)} />
            </Fld>
          </div>

          <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Fld label="Potential business (₹)" hint="Summed from what was captured at the stand">
              <input name="potential_value_inr" inputMode="decimal" style={INPUT}
                defaultValue={val(review?.potential_value_inr, derived.potential)} />
            </Fld>
            <Fld label="Business actually won (₹)" hint="Leave blank until something closes">
              <input name="business_won_inr" inputMode="decimal" style={INPUT}
                defaultValue={review?.business_won_inr ?? ''} />
            </Fld>
          </div>

          <Fld label="Stand footfall"><input name="footfall" inputMode="numeric" style={INPUT} defaultValue={review?.footfall ?? ''} /></Fld>
          <Fld label="What worked well"><textarea name="what_worked" rows={2} style={{ ...INPUT, resize: 'vertical' }} defaultValue={review?.what_worked ?? ''} /></Fld>
          <Fld label="What did not work"><textarea name="what_did_not" rows={2} style={{ ...INPUT, resize: 'vertical' }} defaultValue={review?.what_did_not ?? ''} /></Fld>
          <Fld label="Key learnings"><textarea name="key_learnings" rows={2} style={{ ...INPUT, resize: 'vertical' }} defaultValue={review?.key_learnings ?? ''} /></Fld>
          <Fld label="Competitors seen"><textarea name="competitor_notes" rows={2} style={{ ...INPUT, resize: 'vertical' }} defaultValue={review?.competitor_notes ?? ''} /></Fld>

          <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Fld label="Attend next year?">
              <select name="attend_next_year" defaultValue={review?.attend_next_year ?? ''} style={INPUT}>
                <option value="">— Select —</option>
                {['Yes', 'No', 'Undecided'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Fld>
            <Fld label="Notes for next year">
              <input name="next_year_notes" style={INPUT} defaultValue={review?.next_year_notes ?? ''} />
            </Fld>
          </div>

          {err && <div style={ERR}>{err}</div>}
          <div className="exh-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {review && <button type="button" onClick={() => setEdit(false)} style={BTN_GHOST}>Cancel</button>}
            <button type="submit" disabled={busy} style={BTN_PRIMARY}>{busy ? 'Saving…' : 'Save summary'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Fld({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={LABEL}>{label}</label>
      {children}
      {hint && <p style={HINT}>{hint}</p>}
    </div>
  );
}

function Note({ k, v }: { k: string; v: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
      <div style={{ fontSize: 12, color: 'var(--fg-2)', whiteSpace: 'pre-wrap' }}>
        {v || <span style={{ color: 'var(--fg-3)' }}>—</span>}
      </div>
    </div>
  );
}

// ── Expenses + close ─────────────────────────────────────────────

function ExpenseSignOff({ exhibitionId, expenses, reviewedAt, editable }: {
  exhibitionId: number; expenses: ExpenseRow[]; reviewedAt: string | null; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
  const est = expenses.reduce((s, x) => s + n(x.estimated_inr), 0);
  const act = expenses.reduce((s, x) => s + n(x.actual_inr), 0);
  const paid = expenses.reduce((s, x) => s + n(x.paid_inr), 0);
  const unpaid = expenses.filter(x => n(x.actual_inr) > n(x.paid_inr));
  const noInvoice = expenses.filter(x => !x.has_invoice);

  return (
    <div style={{ ...PANEL, padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 12 }}>
        <Fig label="Estimated" v={fmtInrFull(est)} />
        <Fig label="Actual"    v={fmtInrFull(act)} />
        <Fig label="Paid"      v={fmtInrFull(paid)} />
        <Fig label="Outstanding" v={fmtInrFull(Math.max(0, act - paid))} warn={act > paid} />
      </div>

      {(unpaid.length > 0 || noInvoice.length > 0) && (
        <div style={{ ...NOTE, background: 'var(--neg-soft)', border: '1px solid var(--neg)', marginBottom: 12 }}>
          <b>These block closing:</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {unpaid.map(x => <li key={`u${x.id}`}>{x.category} — {fmtInrFull(n(x.actual_inr) - n(x.paid_inr))} still unpaid</li>)}
            {noInvoice.map(x => <li key={`i${x.id}`}>{x.category} — no invoice attached</li>)}
          </ul>
        </div>
      )}

      {reviewedAt ? (
        <div style={{ fontSize: 12, color: 'var(--pos-strong)' }}>✓ Expenses signed off on {reviewedAt.slice(0, 10)}</div>
      ) : editable ? (
        <>
          {err && <div style={{ ...ERR, marginBottom: 8 }}>{err}</div>}
          <button disabled={busy || unpaid.length > 0 || noInvoice.length > 0}
            title={unpaid.length || noInvoice.length ? 'Settle the lines listed above first' : undefined}
            onClick={async () => {
              setBusy(true); setErr('');
              try {
                // Not the owner, or already closed: the sentence says which.
                const res = await reviewExhibitionExpenses(exhibitionId);
                if (!res.ok) { setErr(res.error); return; }
                router.refresh();
              }
              catch (e) { setErr(e instanceof Error ? e.message : 'Could not sign off.'); }
              finally { setBusy(false); }
            }}
            style={{ ...BTN_PRIMARY, opacity: busy || unpaid.length || noInvoice.length ? 0.55 : 1 }}>
            {busy ? 'Saving…' : '✓ Confirm these figures'}
          </button>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Not signed off yet.</div>
      )}
    </div>
  );
}

function ClosePanel({ exhibitionId, blockers, hasReview, closed, editable }: {
  exhibitionId: number; blockers: string[]; hasReview: boolean; closed: boolean; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [confirm, setConfirm] = useState(false);

  if (closed) return null;

  return (
    <div style={{ ...PANEL, padding: 16 }}>
      {blockers.length > 0 ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 8 }}>Still to do before closing:</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--fg-2)' }}>
            {blockers.map(b => <li key={b}>{b}</li>)}
          </ul>
        </>
      ) : !editable ? (
        <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>Everything is ready. The exhibition owner can close it.</div>
      ) : !confirm ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 10 }}>
            Everything is done{hasReview ? '' : ' except the review'}. Closing locks the meetings,
            expenses and review permanently — only a sysadmin can reopen it.
          </div>
          <button onClick={() => setConfirm(true)} style={BTN_PRIMARY}>Close exhibition</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 10 }}>
            <b>Close this exhibition for good?</b> Nothing can be edited afterwards.
          </div>
          {err && <div style={{ ...ERR, marginBottom: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirm(false)} style={BTN_GHOST}>Cancel</button>
            <button disabled={busy} onClick={async () => {
              setBusy(true); setErr('');
              try {
                const res = await closeExhibition(exhibitionId);
                if (!res.ok) { setErr(res.error); setBusy(false); return; }
                router.refresh();
              } catch {
                setErr('Could not reach the server. Check your connection and try again.');
                setBusy(false);
              }
            }} style={BTN_PRIMARY}>{busy ? 'Closing…' : 'Yes, close it'}</button>
          </div>
        </>
      )}
    </div>
  );
}

function ClosedBanner({ closedAt, closedByName, exhibitionId, isSysadmin }: {
  closedAt: string | null; closedByName: string | null; exhibitionId: number; isSysadmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div style={{ ...NOTE, background: 'var(--bg-elev)', border: '1px solid var(--line-strong)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>
          <b>🔒 Closed{closedAt ? ` on ${closedAt.slice(0, 10)}` : ''}{closedByName ? ` by ${closedByName}` : ''}.</b>
          {' '}Meetings, expenses and the review are read-only.
        </span>
        <a href={`/api/risansi/exhibitions/${exhibitionId}/export`} className="exh-export" style={{ ...BTN_PRIMARY, marginLeft: 'auto', textDecoration: 'none', whiteSpace: 'nowrap' }}
          title="Everything about this exhibition as a workbook: the event, every meeting with its contact, the contacts alone, the team, expenses, the review and the history">
          ⤓ Export to Excel
        </a>
      </div>
      {isSysadmin && (
        open ? (
          <div style={{ marginTop: 10 }}>
            <input value={reason} onChange={e => setReason(e.target.value)} style={INPUT}
              placeholder="Why is this being reopened? (recorded in the history)" />
            {err && <div style={{ ...ERR, marginTop: 8 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => setOpen(false)} style={BTN_GHOST}>Cancel</button>
              <button disabled={busy || !reason.trim()} onClick={async () => {
                setBusy(true); setErr('');
                try {
                  // "Give a reason for reopening." and the sysadmin-only
                  // refusal both land in the banner above the buttons now.
                  const res = await reopenExhibition(exhibitionId, reason);
                  if (!res.ok) { setErr(res.error); setBusy(false); return; }
                  router.refresh();
                }
                catch (e) { setErr(e instanceof Error ? e.message : 'Could not reopen.'); setBusy(false); }
              }} style={BTN_PRIMARY}>{busy ? 'Reopening…' : 'Reopen'}</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setOpen(true)} style={{ ...LINK_BTN, marginLeft: 8 }}>Reopen</button>
        )
      )}
    </div>
  );
}

// ── A meeting becomes a Prospective Lead ─────────────────────────
//
// The company met at the stand is not on the books. Converting creates a
// Prospective-Lead client with an auto-generated LEAD_ code, carries every
// person met across as a contact (the first primary), and opens a Suspect
// opportunity for the potential value the rep wrote down. convertMeetingToLead
// does all of that; what follows is the form it reads.
//
// Which fields: the ones the Client Master's own create form enforces — legal
// name, industry, client type — plus the location it offers and the primary
// rep, because a client with nobody owning it is visible to admins only and
// waits in Reps & Managers → Unassigned until somebody notices. There is
// deliberately no ERP code field: a Prospective-Lead's code is generated from
// the name, which is the whole difference between a lead and a client.

/** What the lead form holds. Serialised straight into the action's FormData. */
export interface LeadDraft {
  legal_name: string; industry: string; client_type: string;
  market_type: string; is_sugar: boolean;
  country: string; state: string; city: string; address: string; google_maps_url: string;
  primary_rep_id: string; tour_id: string;
  contact_person: string; designation: string; phone: string; email: string;
}

/** The meeting, as much of it as the lead form needs. */
export interface LeadSource {
  id: number; company_name: string; city: string | null;
  contact_person: string | null; designation: string | null;
  phone: string | null; email: string | null;
  met_by?: number | null;
  client_id: number | null; client_legal_name: string | null;
  lead_client_id?: number | null;
  contacts?: MeetingContactRow[];
}

const MARKET_TYPES = ['Domestic', 'Export'];

// The same words the Client Master ticks "Sugar" from. Its list also spells out
// the two compound industries ("Sugar + Distillery"), which these three already
// match on substring, so the behaviour is identical.
const SUGAR_WORDS = ['SUGAR', 'DISTILLERY', 'JAGGERY'];
const looksSugar = (industry: string) =>
  SUGAR_WORDS.some(w => industry.toUpperCase().includes(w));

export function newLeadDraft(m: LeadSource): LeadDraft {
  const first = m.contacts?.[0];
  return {
    legal_name: m.company_name ?? '',
    industry: '', client_type: '',
    market_type: 'Domestic', is_sugar: false,
    country: 'India', state: '', city: m.city ?? '', address: '', google_maps_url: '',
    // Whoever took the meeting is the obvious owner of what it becomes. The
    // action falls back to them anyway if this is left blank.
    primary_rep_id: m.met_by != null ? String(m.met_by) : '',
    tour_id: '',
    contact_person: first?.name ?? m.contact_person ?? '',
    designation: first?.designation ?? m.designation ?? '',
    phone: first?.phone ?? m.phone ?? '',
    email: first?.email ?? m.email ?? '',
  };
}

export function leadFormData(d: LeadDraft): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(d)) fd.set(k, typeof v === 'boolean' ? String(v) : v);
  return fd;
}

/**
 * Why this draft cannot be saved yet, in the words the Client Master would use.
 * Checked here so a missing industry is a sentence next to the field rather
 * than a round trip, and checked again by the client form's own constraints
 * when the row lands.
 */
export function leadDraftProblem(d: LeadDraft): string | null {
  if (!d.legal_name.trim())  return 'Company name is required.';
  if (!d.industry.trim())    return 'Pick the industry — the Client Master requires one on every client.';
  if (!d.client_type.trim()) return 'Pick the client type — the Client Master requires one on every client.';
  return null;
}

/** Already on the books, so there is nothing to create. Said here as well as by
 *  the action, so the reason is on screen before the button is pressed. */
export function leadBlockedReason(m: LeadSource): string | null {
  if (m.client_id != null) {
    return `${m.client_legal_name ?? m.company_name} is already a client — raise an opportunity on the account instead.`;
  }
  if (m.lead_client_id != null) return 'A lead has already been created from this meeting.';
  return null;
}

/**
 * The client fields, revealed in whatever form is asking for them — the
 * disposition editor in the review table, or the dialog the Meetings tab opens.
 * Controlled from the caller's draft so either one can serialise it the same way.
 */
export function LeadFields({ draft, onChange, users, contacts }: {
  draft: LeadDraft;
  onChange: (patch: Partial<LeadDraft>) => void;
  users: UserOpt[];
  contacts: MeetingContactRow[];
}) {
  const [industries, setIndustries] = useState<string[]>([]);
  const [tours, setTours] = useState<Array<{ id: string; name: string; zone: string | null }>>([]);

  // Fetched when the fields are revealed, not with the table — thirty-four
  // meeting rows must not mean thirty-four requests for the same two lists.
  useEffect(() => {
    fetch('/api/risansi/industries').then(r => r.json())
      .then(d => setIndustries(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => {
    fetch('/api/risansi/tours').then(r => r.json())
      .then(d => setTours(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // Reps and managers own accounts. Whoever took the meeting stays in the list
  // even if they are neither, so the pre-filled owner is visible rather than
  // looking like a blank select that nonetheless posts somebody.
  const owners = users.filter(u =>
    u.role === 'rep' || u.role === 'manager' || String(u.id) === draft.primary_rep_id);
  const industryOpts = draft.industry && !industries.includes(draft.industry)
    ? [draft.industry, ...industries] : industries;
  const rest = contacts.slice(1).filter(c => c.name);

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 12, padding: 12, borderRadius: 8,
                  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)' }}>
      <div style={{ fontSize: 11.5, color: 'var(--fg-2)' }}>
        A new <b>Prospective-Lead</b> client. Its code is generated from the name — no ERP
        code is needed, and one can be given later when they become a client.
      </div>

      <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Fld label="Company legal name *">
          <input value={draft.legal_name} onChange={e => onChange({ legal_name: e.target.value })}
            style={INPUT} aria-label="Company legal name" />
        </Fld>
        <Fld label="Primary rep — owns the account"
          hint={draft.primary_rep_id ? undefined : 'Left blank, whoever took the meeting gets it.'}>
          <select value={draft.primary_rep_id} onChange={e => onChange({ primary_rep_id: e.target.value })} style={INPUT}>
            <option value="">— Whoever took the meeting —</option>
            {owners.map(u => (
              <option key={u.id} value={String(u.id)}>{u.name}{u.role === 'manager' ? ' · manager' : ''}</option>
            ))}
          </select>
        </Fld>
      </div>

      <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Fld label="Industry *">
          <select value={draft.industry} style={INPUT}
            onChange={e => onChange({ industry: e.target.value, is_sugar: looksSugar(e.target.value) })}>
            <option value="">— Select industry —</option>
            {industryOpts.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </Fld>
        <Fld label="Client type *">
          <select value={draft.client_type} onChange={e => onChange({ client_type: e.target.value })} style={INPUT}>
            <option value="">— Select type —</option>
            {CLIENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Fld>
      </div>

      <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Fld label="Market">
          <select value={draft.market_type} onChange={e => onChange({ market_type: e.target.value })} style={INPUT}>
            {MARKET_TYPES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Fld>
        <Fld label="Sugar / Non-Sugar" hint="Set from the industry; change it if that is wrong.">
          <div style={{ display: 'flex', gap: 6 }}>
            {([['Sugar', true], ['Non-Sugar', false]] as const).map(([label, on]) => {
              const picked = draft.is_sugar === on;
              return (
                <button key={label} type="button" onClick={() => onChange({ is_sugar: on })}
                  aria-pressed={picked}
                  style={{
                    flex: 1, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                    borderRadius: 6, fontWeight: picked ? 600 : 500,
                    border: `1px solid ${picked ? 'var(--accent)' : 'var(--line-strong)'}`,
                    background: picked ? 'var(--accent-soft)' : 'var(--bg-paper)',
                    color: picked ? 'var(--title)' : 'var(--fg-2)',
                  }}>{label}</button>
              );
            })}
          </div>
        </Fld>
      </div>

      <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Fld label="Country">
          <select value={draft.country} onChange={e => onChange({ country: e.target.value, state: '' })} style={INPUT}>
            {countryGroupsWith(draft.country).map(g => (
              <optgroup key={g.region} label={g.region}>
                {g.countries.map(c => <option key={c} value={c}>{c}</option>)}
              </optgroup>
            ))}
          </select>
        </Fld>
        <Fld label="State">
          {draft.country === 'India' ? (
            <select value={draft.state} onChange={e => onChange({ state: e.target.value })} style={INPUT}>
              <option value="">— Select state —</option>
              {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input value={draft.state} onChange={e => onChange({ state: e.target.value })}
              placeholder="State / region" style={INPUT} aria-label="State or region" />
          )}
        </Fld>
      </div>

      <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Fld label="City">
          <input value={draft.city} onChange={e => onChange({ city: e.target.value })} style={INPUT} aria-label="City" />
        </Fld>
        <Fld label="Tour">
          <select value={draft.tour_id} onChange={e => onChange({ tour_id: e.target.value })} style={INPUT}>
            <option value="">— No tour —</option>
            {tours.map(t => <option key={t.id} value={t.id}>{t.name}{t.zone ? ` · ${t.zone}` : ''}</option>)}
          </select>
        </Fld>
      </div>

      <Fld label="Address">
        <textarea rows={2} value={draft.address} onChange={e => onChange({ address: e.target.value })}
          style={{ ...INPUT, resize: 'vertical' }} aria-label="Address" />
      </Fld>
      <Fld label="Google Maps URL">
        <input value={draft.google_maps_url} onChange={e => onChange({ google_maps_url: e.target.value })}
          placeholder="https://maps.google.com/…" style={INPUT} aria-label="Google Maps URL" />
      </Fld>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Primary contact
        </div>
        <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Fld label="Name">
            <input value={draft.contact_person} onChange={e => onChange({ contact_person: e.target.value })}
              style={INPUT} aria-label="Contact name" />
          </Fld>
          <Fld label="Designation">
            <input value={draft.designation} onChange={e => onChange({ designation: e.target.value })}
              style={INPUT} aria-label="Contact designation" />
          </Fld>
        </div>
        <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Fld label="Phone">
            <input value={draft.phone} onChange={e => onChange({ phone: e.target.value })}
              style={INPUT} aria-label="Contact phone" />
          </Fld>
          <Fld label="Email">
            <input value={draft.email} onChange={e => onChange({ email: e.target.value })}
              style={INPUT} aria-label="Contact email" />
          </Fld>
        </div>
        {rest.length > 0 && (
          <p style={{ ...HINT, marginTop: 8 }}>
            {rest.length === 1 ? 'One more person' : `${rest.length} more people`} met at this
            meeting {rest.length === 1 ? 'comes' : 'come'} across too
            — {rest.map(c => c.name).join(', ')}.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The same conversion, as a dialog, for the Meetings tab.
 *
 * The review is where a marked company is decided, but a rep who has just
 * captured a meeting wants the lead there and then rather than after the event
 * closes — so the Meetings tab offers it on the row, and this is what opens.
 * Closing follows the house rule: the backdrop does not throw away typing, and
 * the × asks first.
 */
export function MeetingLeadDialog({ exhibitionId, meeting, users, onDone }: {
  exhibitionId: number; meeting: LeadSource; users: UserOpt[]; onDone: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<LeadDraft>(() => newLeadDraft(meeting));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');
  const panel = useRef<HTMLDivElement | null>(null);
  const guard = useCloseGuard({ dirty, onClose: onDone, enabled: !busy });
  useDialogFocus(panel);

  const blocked = leadBlockedReason(meeting);
  const patch = (p: Partial<LeadDraft>) => { setDraft(d => ({ ...d, ...p })); setDirty(true); };

  async function save() {
    const problem = blocked ?? leadDraftProblem(draft);
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr('');
    try {
      const res = await convertMeetingToLead(exhibitionId, meeting.id, leadFormData(draft));
      if (!res.ok) { setErr(res.error); setBusy(false); return; }
      router.refresh(); onDone();
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const redacted = !raw || /unexpected response|Server Components render/i.test(raw)
        || Boolean((e as { digest?: string })?.digest);
      setErr(redacted ? 'Could not create the lead. You may not be the person running this exhibition.' : raw);
      setBusy(false);
    }
  }

  return (
    <div onClick={guard.onBackdropClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 430, background: 'rgba(10,22,40,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
      <div className="risansi-modal" ref={panel} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label={`Convert ${meeting.company_name} to a Prospective Lead`}
        style={{
          width: 760, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto',
          background: 'var(--bg-paper)', color: 'var(--fg)', borderRadius: 12,
          boxShadow: '0 24px 64px rgba(10,61,143,0.25)', outline: 'none',
        }}>
        <div style={{
          padding: '14px 18px', background: 'var(--accent-soft)', color: 'var(--title)',
          borderBottom: '1px solid var(--accent-line)', position: 'sticky', top: 0, zIndex: 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere' }}>
                {meeting.company_name} → Prospective Lead
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginTop: 3 }}>
                Creates the client, its contacts and a Suspect opportunity.
              </div>
            </div>
            <CloseX onClick={guard.requestClose} title="Close this form" />
          </div>
          {guard.asking && (
            <CloseConfirm
              message="Close without creating the lead? What you typed here will be lost."
              onConfirm={guard.confirmClose} onCancel={guard.keepEditing} />
          )}
          {guard.hint && !guard.asking && <KeepOpenHint />}
        </div>

        <div style={{ padding: 18 }}>
          {blocked && <div style={{ ...ERR, marginBottom: 12 }}>{blocked}</div>}
          <LeadFields draft={draft} onChange={patch} users={users} contacts={meeting.contacts ?? []} />
          {err && <div style={{ ...ERR, marginTop: 12 }}>{err}</div>}
          <div className="exh-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button type="button" onClick={guard.requestClose} style={BTN_GHOST}>Cancel</button>
            <button type="button" onClick={save} disabled={busy || !!blocked}
              style={{ ...BTN_PRIMARY, opacity: busy || blocked ? 0.55 : 1 }}>
              {busy ? 'Creating…' : 'Create Prospective Lead'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────

function StepHead({ n, title, sub, done }: { n: number; title: string; sub?: string; done?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{
        width: 22, height: 22, borderRadius: 999, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 11, fontWeight: 700,
        background: done ? 'var(--pos-soft)' : 'var(--bg-elev)',
        color: done ? 'var(--pos-strong)' : 'var(--fg-3)',
      }}>{done ? '✓' : n}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--title)' }}>{title}</span>
      {sub && <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>· {sub}</span>}
    </div>
  );
}

function Fig({ label, v, warn }: { label: string; v: string; warn?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginTop: 2, color: warn ? 'var(--neg)' : 'var(--fg)' }}>{v}</div>
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' };
const NOTE: CSSProperties = { padding: 12, borderRadius: 8, fontSize: 13, color: 'var(--fg-2)' };
const BLANK: CSSProperties = { padding: 26, textAlign: 'center', fontSize: 13, color: 'var(--fg-3)' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
const INPUT: CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 13, background: 'var(--bg-paper)', color: 'var(--fg)', boxSizing: 'border-box', fontFamily: 'inherit' };
const LABEL: CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 };
const HINT: CSSProperties = { fontSize: 11, color: 'var(--fg-3)', marginTop: 4 };
const BTN_PRIMARY: CSSProperties = { padding: '8px 16px', borderRadius: 6, background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit' };
const BTN_GHOST: CSSProperties = { padding: '8px 16px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg-2)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' };
const LINK_BTN: CSSProperties = { background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', textDecoration: 'underline' };
const ERR: CSSProperties = { padding: '8px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderLeft: '3px solid var(--neg)', borderRadius: 5, color: 'var(--neg-strong)', fontSize: 12 };
const KNOWN_PILL: CSSProperties = { padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: 'var(--pos-soft)', color: 'var(--pos-strong)' };
const NEW_PILL: CSSProperties = { padding: '1px 7px', borderRadius: 999, fontSize: 10, background: 'var(--bg-elev)', color: 'var(--fg-3)' };
const DONE_PILL: CSSProperties = { padding: '1px 7px', borderRadius: 999, fontSize: 10, background: 'var(--accent-soft)', color: 'var(--title)' };
