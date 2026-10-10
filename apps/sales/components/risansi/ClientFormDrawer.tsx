'use client';

import { useState, useEffect, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { addClient, updateClient } from '@/app/actions/risansi';
import { leadCodeBase } from '@/lib/risansi-lead-code';
import { isLeadCode } from '@/lib/risansi-client-status';
import { ConvertLeadButton } from './ConvertLeadButton';
import { CLIENT_TYPES } from '@/lib/risansi-client-types';
import { INDIAN_STATES } from '@/lib/risansi-geo';
import { countryGroupsWith } from '@/lib/risansi-geo-regions';
import { CLIENT_STATUS_LABELS, allowedStatusesForCode } from '@/lib/risansi-client-status';

// ── Types ──────────────────────────────────────────────────────

type ContactRow = {
  id?: number;          // exists for saved contacts
  name: string;
  designation: string;
  phone: string;
  email: string;
  whatsapp: string;
  is_primary: boolean;
  isNew?: boolean;      // true for unsaved rows
};

interface Props {
  mode: 'create' | 'edit';
  client?: any;                 // pre-filled data (edit mode, or defaults in create mode)
  existingContacts?: any[];     // live (non-imported) contacts for edit mode
  allowCodeEdit?: boolean;      // edit mode: allow changing the client code (Client Master only)
  /**
   * Create mode: save through this instead of addClient.
   *
   * The exhibition review turns a marked meeting into a lead, and needs the
   * new client's id to link the meeting and raise its opportunity. The form
   * itself is the same one the Client Master uses, which is the point — a
   * lead born at a stand is a client record like any other.
   */
  submit?: (fd: FormData) => Promise<void>;
  title?: string;
  onClose: () => void;
}

// ── Option lists ───────────────────────────────────────────────

const MARKET_TYPES      = ['Domestic', 'Export'];
const CAPACITY_BRACKETS = ['0-5000', '5001-9000', '9001 & above'];
const TIER_OPTIONS      = ['Key', 'Standard', 'OEM/Trader'];
const SUGAR_INDUSTRIES  = ['Sugar', 'Distillery', 'Jaggery', 'Sugar + Distillery', 'Sugar & Distillery'];
const MAX_CONTACTS      = 10;

// Make sure a pre-existing DB value still shows in a fixed-option select
function withCurrent(opts: string[], current: unknown): string[] {
  const v = typeof current === 'string' ? current.trim() : '';
  return v && !opts.includes(v) ? [v, ...opts] : opts;
}

// ── Component ──────────────────────────────────────────────────

export function ClientFormDrawer({ mode, client, existingContacts, allowCodeEdit, submit, title, onClose }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [visible, setVisible] = useState(false);
  const [error, setError]     = useState('');

  // Create-mode: is this a full Client (admin types the code) or a Lead (code auto-
  // generated from the name)? `nameForCode` mirrors the legal-name input for the live
  // LEAD_ preview.
  // Create-mode segregation: Prospective vs Active, and (when Prospective) Lead vs
  // Client. A Prospective-Lead auto-generates a LEAD_ code; everything else takes a
  // typed ERP code. `status` is derived from the two toggles.
  const [newKind,   setNewKind]   = useState<'prospective' | 'active'>('prospective');
  const [prospKind, setProspKind] = useState<'lead' | 'client'>('lead');
  const isLeadEntry  = mode === 'create' && newKind === 'prospective' && prospKind === 'lead';
  const createStatus = newKind === 'active'
    ? 'ACTIVE'
    : prospKind === 'lead' ? 'PROSPECTIVE_LEAD' : 'PROSPECTIVE_CLIENT';
  const [nameForCode, setNameForCode] = useState<string>(client?.legal_name ?? '');

  const [industries, setIndustries] = useState<string[]>([]);
  const [industry, setIndustry]     = useState<string>(client?.industry ?? '');
  const [isSugar, setIsSugar]       = useState<boolean>(Boolean(client?.is_sugar));
  const [mapsUrl, setMapsUrl]       = useState<string>(client?.google_maps_url ?? '');
  const [country, setCountry]       = useState<string>(client?.country ?? 'India');
  // Edit mode with an editable code (Client Master): track the live code so the
  // status options recompute when it flips between LEAD_ and a real code.
  const [codeDraft, setCodeDraft]   = useState<string>(client?.code ?? '');

  // Route (an attribute of the client) and the people who work it.
  const [tours, setTours]   = useState<Array<{ id: string; name: string; zone: string | null }>>([]);
  const [tourId, setTourId] = useState<string>(client?.tour_id != null ? String(client.tour_id) : '');

  // Ownership. A client with no primary rep is visible to admins only, so asking
  // for one at creation is the difference between a client that works and one
  // that silently lands in the Unassigned tab for somebody to find later.
  const [people, setPeople] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [primaryRep, setPrimaryRep] = useState<string>(
    (client as { primary_rep_id?: number | string | null } | undefined)?.primary_rep_id != null
      ? String((client as { primary_rep_id?: number | string | null }).primary_rep_id) : '');
  const [coverReps, setCoverReps] = useState<string[]>(
    ((client as { secondary_rep_ids?: (number | string)[] } | undefined)?.secondary_rep_ids ?? []).map(String));

  const [contacts, setContacts] = useState<ContactRow[]>(
    (existingContacts ?? []).map((c: any) => ({
      id:          c.id,
      name:        c.name ?? '',
      designation: c.designation ?? '',
      phone:       c.phone ?? '',
      email:       c.email ?? '',
      whatsapp:    c.whatsapp ?? '',
      is_primary:  Boolean(c.is_primary),
      isNew:       false,
    })),
  );
  const [deletedContactIds, setDeletedContactIds] = useState<number[]>([]);

  // Slide-in on mount (component is rendered only while open)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Fetch industry options
  useEffect(() => {
    fetch('/api/risansi/industries')
      .then(r => r.json())
      .then(d => setIndustries(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // Fetch tour routes for the dropdown
  useEffect(() => {
    fetch('/api/risansi/tours')
      .then(r => r.json())
      .then(d => setTours(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // Reps and managers for the ownership pickers.
  useEffect(() => {
    fetch('/api/risansi/reps')
      .then(r => r.json())
      .then((d: Array<{ id: string; name: string; role: string }>) =>
        setPeople(Array.isArray(d) ? d.filter(u => u.role === 'rep' || u.role === 'manager') : []))
      .catch(() => {});
  }, []);


  function handleIndustryChange(val: string) {
    setIndustry(val);
    setIsSugar(SUGAR_INDUSTRIES.some(s => val.toUpperCase().includes(s.toUpperCase())));
  }

  function close() {
    setVisible(false);
    setTimeout(onClose, 240);
  }

  // ── Contact row helpers ──────────────────────────────────────

  function addContactRow() {
    setContacts(cs => cs.length >= MAX_CONTACTS ? cs : [
      ...cs,
      { name: '', designation: '', phone: '', email: '', whatsapp: '', is_primary: false, isNew: true },
    ]);
  }

  function removeContactRow(idx: number) {
    setContacts(cs => {
      const row = cs[idx];
      if (row?.id && !row.isNew) setDeletedContactIds(ids => [...ids, row.id!]);
      return cs.filter((_, i) => i !== idx);
    });
  }

  function patchContact(idx: number, patch: Partial<ContactRow>) {
    setContacts(cs => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  // Only one contact may be primary at a time
  function setPrimary(idx: number, checked: boolean) {
    setContacts(cs => cs.map((c, i) => ({ ...c, is_primary: i === idx ? checked : false })));
  }

  // ── Submit ───────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    fd.set('contacts_json', JSON.stringify(contacts));
    fd.set('deleted_contact_ids', JSON.stringify(deletedContactIds));
    fd.set('is_sugar', String(isSugar));

    startTransition(async () => {
      try {
        // These return their refusals rather than throwing them. A thrown
        // message is redacted in production, which is how "that code belongs
        // to a client that was archived" reached somebody as "an error
        // occurred" and they retried the same code.
        if (mode === 'create') {
          if (submit) { await submit(fd); }
          else {
            const res = await addClient(fd);
            if (!res.ok) { setError(res.error); return; }
          }
        } else {
          const res = await updateClient(Number(client.id), fd);
          if (!res.ok) { setError(res.error); return; }
        }
        router.refresh();
        close();
      } catch (err) {
        // Only a genuine fault reaches here now — a refusal came back above.
        setError(err instanceof Error ? err.message : 'Failed to save client');
      }
    });
  }

  const isDistillery   = industry.toUpperCase().includes('DISTILLERY');
  const industryOpts   = withCurrent(industries, client?.industry);
  const clientTypeOpts = withCurrent(CLIENT_TYPES, client?.client_type);
  const capacityOpts   = withCurrent(CAPACITY_BRACKETS, client?.capacity_bracket);
  // Edit mode: statuses valid for the client's code type (lead vs real). In Client
  // Master (allowCodeEdit) the code is editable, so track the live draft so the
  // options refresh when it flips LEAD_ ↔ real. Plus the current value, defensively.
  const statusCode     = mode === 'edit' && allowCodeEdit ? codeDraft : client?.code;
  const statusOpts     = withCurrent(allowedStatusesForCode(statusCode), client?.status);
  const tierOpts       = withCurrent(TIER_OPTIONS, client?.tier);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(10,22,40,0.35)',
          opacity: visible ? 1 : 0, transition: 'opacity 0.24s ease',
        }}
      />

      {/* Slide-in drawer — 560px. risansi-drawer makes it full-screen on a
          phone, the same as every other drawer (see mobile.css). */}
      <div className="risansi-drawer" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 720, maxWidth: '100vw', zIndex: 50,
        background: 'var(--bg-paper)',
        boxShadow: '-8px 0 40px rgba(10,22,40,0.14)',
        display: 'flex', flexDirection: 'column',
        transform: visible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.26s cubic-bezier(0.32,0,0.67,0)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--title)', letterSpacing: '-0.01em' }}>
            {title ?? (mode === 'create' ? 'New Client' : 'Edit Client')}
            {mode === 'edit' && (
              <span style={{ fontFamily: 'monospace', fontWeight: 400, color: 'var(--fg-3)', marginLeft: 8, fontSize: 13 }}>
                · {client?.code}
              </span>
            )}
          </div>
          <button type="button" onClick={close} style={CLOSE_BTN}>✕</button>
        </div>

        {/* Scrollable form */}
        <form
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}
        >

          {/* ── 1. Identity ── */}
          <Section label="Identity">
            {mode === 'create' && (
              <>
                <Field label="Status">
                  <div style={{ display: 'inline-flex', border: '1px solid var(--line-strong)', borderRadius: 7, overflow: 'hidden' }}>
                    {(['prospective', 'active'] as const).map((t, i) => {
                      const on = newKind === t;
                      return (
                        <button key={t} type="button" onClick={() => setNewKind(t)}
                          style={{
                            padding: '7px 18px', fontSize: 13, fontFamily: 'inherit', cursor: on ? 'default' : 'pointer',
                            border: 'none', borderLeft: i === 0 ? 'none' : '1px solid var(--line)',
                            background: on ? 'var(--brand-blue)' : 'transparent',
                            color: on ? '#fff' : 'var(--fg-2)', fontWeight: on ? 600 : 500,
                          }}>
                          {t === 'prospective' ? 'Prospective' : 'Active'}
                        </button>
                      );
                    })}
                  </div>
                  <div style={HINT}>
                    {newKind === 'active'
                      ? 'An existing client who has placed an order — enter their ERP client code.'
                      : 'Not yet a client. Choose whether they are a raw lead or an enquiry with a code.'}
                  </div>
                </Field>

                {newKind === 'prospective' && (
                  <Field label="Prospective Type">
                    <div style={{ display: 'inline-flex', border: '1px solid var(--line-strong)', borderRadius: 7, overflow: 'hidden' }}>
                      {(['lead', 'client'] as const).map((t, i) => {
                        const on = prospKind === t;
                        return (
                          <button key={t} type="button" onClick={() => setProspKind(t)}
                            style={{
                              padding: '7px 16px', fontSize: 13, fontFamily: 'inherit', cursor: on ? 'default' : 'pointer',
                              border: 'none', borderLeft: i === 0 ? 'none' : '1px solid var(--line)',
                              background: on ? 'var(--brand-blue)' : 'transparent',
                              color: on ? '#fff' : 'var(--fg-2)', fontWeight: on ? 600 : 500,
                            }}>
                            {t === 'lead' ? 'Prospective-Lead' : 'Prospective-Client'}
                          </button>
                        );
                      })}
                    </div>
                    <div style={HINT}>
                      {prospKind === 'lead'
                        ? 'A raw lead — the code is auto-generated (LEAD_…) from the company name.'
                        : 'An enquiry arrived and you have their ERP client code — enter it below.'}
                    </div>
                  </Field>
                )}
              </>
            )}
            {/* Rendered once (not inside the code field) so it never shares a DOM slot
                with the code <input> — otherwise React reuses the node and the code box
                inherits this value on toggle. */}
            {mode === 'create' && (
              <>
                <input type="hidden" name="is_lead" value={isLeadEntry ? 'true' : 'false'} />
                <input type="hidden" name="status"  value={createStatus} />
              </>
            )}
            <Field label="Client Code" required={mode === 'edit' || !isLeadEntry}>
              {mode === 'create' ? (
                !isLeadEntry ? (
                  <>
                    <input
                      type="text" name="code" required maxLength={20}
                      placeholder="e.g. PUNE01A162" style={INP}
                      onChange={e => (e.currentTarget.value = e.currentTarget.value.toUpperCase())}
                    />
                    <div style={HINT}>e.g. PUNE01A162</div>
                  </>
                ) : (
                  <>
                    <div style={{
                      padding: '9px 12px', background: 'var(--bg-sunk)', border: '1px solid var(--line)',
                      borderRadius: 6, fontSize: 13, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)',
                    }}>
                      {nameForCode.trim() ? leadCodeBase(nameForCode) : 'LEAD_…'}
                      <span style={{ marginLeft: 8, fontFamily: 'inherit', fontStyle: 'italic', color: 'var(--fg-3)', fontSize: 11 }}>
                        auto-generated
                      </span>
                    </div>
                    <div style={HINT}>Finalised on save — a number is appended if it collides.</div>
                  </>
                )
              ) : allowCodeEdit && isLeadCode(client?.code) ? (
                // Turning a lead into a client is a conversion, not a rename:
                // the LEAD_ code goes, an ERP code takes its place, the status
                // moves to Prospective-Client and the URL changes with it.
                // Typing over the code by hand did the first part and none of
                // the rest, so the same button the client's own page offers is
                // here instead.
                <>
                  <div style={{
                    padding: '9px 12px', background: 'var(--bg-sunk)', border: '1px solid var(--line)',
                    borderRadius: 6, fontSize: 13, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)',
                  }}>{client?.code}</div>
                  <input type="hidden" name="code" value={String(client?.code ?? '')} />
                  <div style={{ marginTop: 7 }}>
                    <ConvertLeadButton
                      clientId={Number(client?.id)}
                      currentCode={String(client?.code ?? '')}
                      legalName={String(client?.legal_name ?? '')}
                    />
                  </div>
                  <div style={HINT}>A lead keeps its auto-generated code until it becomes a client.</div>
                </>
              ) : allowCodeEdit ? (
                <>
                  <input
                    type="text" name="code" required maxLength={20}
                    value={codeDraft} style={{ ...INP, fontFamily: 'var(--font-mono)' }}
                    onChange={e => setCodeDraft(e.target.value.toUpperCase())}
                  />
                  <div style={{ ...HINT, color: 'var(--warn, var(--fg-3))' }}>
                    Changing the code changes this client’s identifier and its URL. Must stay unique.
                  </div>
                </>
              ) : (
                <>
                  <div style={{
                    padding: '9px 12px',
                    background: 'var(--bg-sunk)',
                    border: '1px solid var(--line)',
                    borderRadius: 6, fontSize: 13,
                    color: 'var(--fg-2)',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {client?.code}
                  </div>
                  <input type="hidden" name="code" value={client?.code ?? ''} />
                </>
              )}
            </Field>
            <Field label="Legal Name" required>
              <input type="text" name="legal_name" required maxLength={200}
                defaultValue={client?.legal_name ?? ''} placeholder="Full legal entity name" style={INP}
                onChange={e => setNameForCode(e.currentTarget.value)} />
            </Field>
            <Row>
              <Field label="Trade Name">
                <input type="text" name="trade_name" maxLength={200}
                  defaultValue={client?.trade_name ?? ''} style={INP} />
              </Field>
              <Field label="Group Name">
                <input type="text" name="group_name" maxLength={200}
                  defaultValue={client?.group_name ?? ''} style={INP} />
              </Field>
            </Row>
          </Section>

          {/* ── 2. Classification ── */}
          <Section label="Classification">
            <Row>
              <Field label="Industry" required>
                <select name="industry" required style={INP}
                  value={industry} onChange={e => handleIndustryChange(e.target.value)}>
                  <option value="">Select industry…</option>
                  {industryOpts.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                </select>
              </Field>
              <Field label="Client Type" required>
                <select name="client_type" required style={INP} defaultValue={client?.client_type ?? ''}>
                  <option value="">Select type…</option>
                  {clientTypeOpts.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </Row>
            <Row>
              <Field label="Market Type">
                <select name="market_type" style={INP} defaultValue={client?.market_type ?? 'Domestic'}>
                  {MARKET_TYPES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Sugar / Non-Sugar">
                <div style={{ display: 'flex', gap: 6 }}>
                  <Pill active={isSugar} onClick={() => setIsSugar(true)}>Sugar</Pill>
                  <Pill active={!isSugar} onClick={() => setIsSugar(false)}>Non-Sugar</Pill>
                </div>
              </Field>
            </Row>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
              <input type="checkbox" name="is_tender" value="true"
                defaultChecked={Boolean(client?.is_tender)}
                style={{ width: 15, height: 15, accentColor: 'var(--brand-blue)', cursor: 'pointer' }} />
              <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>Tender account</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
              <input type="checkbox" name="is_end_client" value="true"
                defaultChecked={Boolean((client as { is_end_client?: boolean } | null)?.is_end_client)}
                style={{ width: 15, height: 15, accentColor: 'var(--brand-blue)', cursor: 'pointer' }} />
              <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>End Client <span style={{ color: 'var(--fg-3)', fontWeight: 400 }}>— supplied indirectly (OEM/trader)</span></span>
            </label>
            <Field label="Capacity Bracket">
              <select name="capacity_bracket" style={INP} defaultValue={client?.capacity_bracket ?? ''}>
                <option value="">—</option>
                {capacityOpts.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            {isSugar && (
              <Field label="TCD (Tonnes Cane/Day)">
                <input type="number" name="tcd" min={0} step={1}
                  defaultValue={client?.tcd ?? ''} placeholder="e.g. 2500" style={INP} />
              </Field>
            )}
            {isDistillery && (
              <Field label="KLPD">
                <input type="number" name="klpd" min={0} step={1}
                  defaultValue={client?.klpd ?? ''} placeholder="e.g. 60" style={INP} />
              </Field>
            )}
          </Section>

          {/* ── 3. Location ── */}
          <Section label="Location">
            <Row>
              <Field label="Country">
                <select name="country" value={country}
                  onChange={e => setCountry(e.target.value)} style={INP}>
                  {countryGroupsWith(client?.country).map(g => (
                    <optgroup key={g.region} label={g.region}>
                      {g.countries.map(c => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <Field label="State">
                {country === 'India' ? (
                  <select name="state" defaultValue={client?.state ?? ''} style={INP}>
                    <option value="">— Select state —</option>
                    {withCurrent(INDIAN_STATES, client?.state).map(s =>
                      <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input type="text" name="state" maxLength={100}
                    defaultValue={client?.state ?? ''} placeholder="State / region"
                    style={INP} />
                )}
              </Field>
            </Row>
            <Field label="City">
              <input type="text" name="city" maxLength={100}
                defaultValue={client?.city ?? ''} style={INP} />
            </Field>
            <Field label="Address">
              <textarea name="address" rows={3} maxLength={400}
                defaultValue={client?.address ?? ''}
                style={{ ...INP, height: 'auto', resize: 'vertical' as const, lineHeight: 1.5 }} />
            </Field>
            <Field label="Google Maps URL">
              <input type="text" name="google_maps_url" maxLength={500}
                value={mapsUrl} onChange={e => setMapsUrl(e.target.value)}
                placeholder="https://maps.google.com/…" style={INP} />
              {/^https?:/i.test(mapsUrl.trim()) && (
                <a href={mapsUrl.trim()} target="_blank" rel="noreferrer"
                  style={{ ...HINT, color: 'var(--brand-blue)', display: 'inline-flex', gap: 4, textDecoration: 'none' }}>
                  📍 Preview
                </a>
              )}
            </Field>
          </Section>

          {/* ── 4. Territory ── */}
          <Section label="Territory">
            <Row>
              <Field label="Status">
                {mode === 'create' ? (
                  <div style={{
                    padding: '9px 12px', background: 'var(--bg-sunk)', border: '1px solid var(--line)',
                    borderRadius: 6, fontSize: 13, color: 'var(--fg-2)',
                  }}>
                    {CLIENT_STATUS_LABELS[createStatus] ?? createStatus}
                    <span style={{ marginLeft: 8, fontStyle: 'italic', color: 'var(--fg-3)', fontSize: 11 }}>
                      set above
                    </span>
                  </div>
                ) : (
                  <select name="status" style={INP} defaultValue={client?.status ?? 'ACTIVE'}>
                    {statusOpts.map(s => <option key={s} value={s}>{CLIENT_STATUS_LABELS[s] ?? s}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Tier">
                <select name="tier" style={INP} defaultValue={client?.tier ?? 'Standard'}>
                  {tierOpts.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </Row>
            <Row>
              <Field label="Tour">
                <select name="tour_id" style={INP}
                  value={tourId} onChange={e => setTourId(e.target.value)}>
                  <option value="">— No tour —</option>
                  {tours.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.zone ? ` · ${t.zone}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Since Year">
                <input type="text" name="since_year" maxLength={10}
                  defaultValue={client?.since_year != null ? String(client.since_year) : ''}
                  placeholder='e.g. 2019 or 21-22' style={INP} />
              </Field>
            </Row>
            <Row>
              <Field label="Primary rep — owns the account">
                <select name="primary_rep_id" style={INP}
                  value={primaryRep} onChange={e => setPrimaryRep(e.target.value)}>
                  <option value="">— Nobody yet —</option>
                  {people.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name}{u.role === 'manager' ? ' · manager' : ''}
                    </option>
                  ))}
                </select>
                <div style={HINT}>
                  {primaryRep
                    ? 'New visits and opportunities are filed against them by default.'
                    : 'Without one this client is visible to admins only, and waits in Reps & Managers → Unassigned.'}
                </div>
              </Field>
              <Field label="Also covers — optional">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: 7, border: '1px solid var(--line-strong)', borderRadius: 6, maxHeight: 104, overflowY: 'auto' }}>
                  {people.filter(u => u.id !== primaryRep).length === 0
                    ? <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>Nobody else to add.</span>
                    : people.filter(u => u.id !== primaryRep).map(u => {
                        const on = coverReps.includes(u.id);
                        return (
                          <button key={u.id} type="button"
                            onClick={() => setCoverReps(v => on ? v.filter(x => x !== u.id) : [...v, u.id])}
                            style={{
                              padding: '3px 9px', borderRadius: 999, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit',
                              border: `1px solid ${on ? 'var(--title)' : 'var(--line-strong)'}`,
                              background: on ? 'var(--accent-soft, rgba(26,92,184,0.10))' : 'var(--bg-paper)',
                              color: on ? 'var(--title)' : 'var(--fg-2)',
                            }}>
                            {on ? '✓ ' : ''}{u.name}
                          </button>
                        );
                      })}
                </div>
                <div style={HINT}>Same access as the primary, but never the default owner of new work.</div>
              </Field>
            </Row>
            {/* Sent as JSON because a multi-select posts nothing when empty, and
                "no covering reps" has to be distinguishable from "field absent"
                so an edit can clear the list. */}
            <input type="hidden" name="secondary_rep_ids"
              value={JSON.stringify(coverReps.filter(id => id !== primaryRep).map(Number))} />
          </Section>

          {/* ── 5. Contacts ── */}
          <Section label="Contacts" count={contacts.length}>
            {contacts.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--fg-3)', fontStyle: 'italic' }}>
                No contacts yet — add up to {MAX_CONTACTS}.
              </div>
            )}
            {contacts.map((c, i) => (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 1fr 1fr 1fr auto',
                gap: 6, alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid var(--line)',
              }}>
                <input placeholder="Name *" value={c.name}
                  onChange={e => patchContact(i, { name: e.target.value })} style={SMALL_INP} />
                <input placeholder="Designation" value={c.designation}
                  onChange={e => patchContact(i, { designation: e.target.value })} style={SMALL_INP} />
                <input placeholder="Phone" value={c.phone}
                  onChange={e => patchContact(i, { phone: e.target.value })} style={SMALL_INP} />
                <input placeholder="Email" value={c.email}
                  onChange={e => patchContact(i, { email: e.target.value })} style={SMALL_INP} />
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input type="checkbox" title="Set as primary" checked={c.is_primary}
                    onChange={e => setPrimary(i, e.target.checked)}
                    style={{ width: 14, height: 14, accentColor: 'var(--brand-blue)', cursor: 'pointer' }} />
                  <button type="button" title="Remove" onClick={() => removeContactRow(i)} style={CONTACT_DEL}>×</button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addContactRow} disabled={contacts.length >= MAX_CONTACTS}
              style={{ ...ADD_CONTACT_BTN, opacity: contacts.length >= MAX_CONTACTS ? 0.5 : 1 }}>
              + Add Contact
            </button>
          </Section>

          {error && (
            <div style={{
              padding: '9px 12px', background: 'var(--neg-soft)',
              border: '1px solid var(--neg)', borderRadius: 5,
              fontSize: 12, color: 'var(--neg-strong)',
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={isPending}
            style={{ ...SUBMIT_BTN, opacity: isPending ? 0.55 : 1, cursor: isPending ? 'not-allowed' : 'pointer' }}>
            {isPending ? 'Saving…' : mode === 'create' ? 'Create Client' : 'Save Changes'}
          </button>
        </form>
      </div>
    </>
  );
}

// ── Entry-point trigger for the Client Master page ─────────────

export function AddClientButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={PRIMARY_BTN}>
        + Add Client
      </button>
      {open && <ClientFormDrawer mode="create" onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function Section({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} style={SECTION_HEADER}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {label}
          {count != null && count > 0 && <span style={COUNT_BADGE}>{count}</span>}
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {children}
        </div>
      )}
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

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={LBL}>
        {label}
        {required && <span style={{ color: 'var(--neg)', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: 1, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
      fontWeight: active ? 600 : 500, cursor: 'pointer', borderRadius: 6,
      background: active ? 'var(--accent-fill)' : 'var(--bg-sunk)',
      color:      active ? 'var(--on-accent)' : 'var(--fg-2)',
      border: `1px solid ${active ? 'var(--accent-fill)' : 'var(--line-strong)'}`,
    }}>
      {children}
    </button>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const PRIMARY_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 14px', fontSize: 13, fontFamily: 'inherit',
  fontWeight: 600, background: 'var(--accent-fill)', color: 'var(--on-accent)',
  border: 'none', borderRadius: 6, cursor: 'pointer',
  letterSpacing: '-0.005em', flexShrink: 0,
};

const CLOSE_BTN: CSSProperties = {
  width: 28, height: 28, display: 'grid', placeItems: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 16, color: 'var(--fg-3)', borderRadius: 4,
};

const SECTION_HEADER: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  width: '100%', padding: '0 0 6px', cursor: 'pointer',
  background: 'transparent', border: 'none', borderBottom: '1px solid var(--line)',
  fontSize: 10, fontWeight: 700, color: 'var(--title)',
  textTransform: 'uppercase', letterSpacing: '0.10em',
  fontFamily: 'inherit',
};

const COUNT_BADGE: CSSProperties = {
  background: 'var(--accent-soft)', color: 'var(--brand-blue)', borderRadius: 10,
  padding: '0 7px', fontSize: 11, fontWeight: 700, letterSpacing: 0,
};

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
};

const HINT: CSSProperties = {
  fontSize: 11, color: 'var(--fg-3)', marginTop: 4,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  fontSize: 13, fontFamily: 'inherit',
  background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg)', outline: 'none',
  boxSizing: 'border-box',
};

const SMALL_INP: CSSProperties = {
  display: 'block', width: '100%', padding: '6px 8px',
  fontSize: 12, fontFamily: 'inherit',
  background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 5, color: 'var(--fg)', outline: 'none',
  boxSizing: 'border-box', minWidth: 0,
};

const CONTACT_DEL: CSSProperties = {
  width: 22, height: 22, display: 'grid', placeItems: 'center',
  background: 'transparent', border: '1px solid var(--line)',
  color: 'var(--fg-3)', borderRadius: 5, cursor: 'pointer', fontSize: 14,
};

const ADD_CONTACT_BTN: CSSProperties = {
  alignSelf: 'flex-start', padding: '6px 12px', fontSize: 12,
  fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer',
  background: 'var(--accent-soft)', color: 'var(--brand-blue)',
  border: '1px solid var(--brand-blue)', borderRadius: 6,
};

const SUBMIT_BTN: CSSProperties = {
  width: '100%', padding: '12px 0',
  fontSize: 14, fontFamily: 'inherit', fontWeight: 600,
  background: 'var(--accent-fill)', color: 'var(--on-accent)',
  border: 'none', borderRadius: 6,
  letterSpacing: '-0.005em', marginTop: 4,
};
