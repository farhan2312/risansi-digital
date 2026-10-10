'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { createPipelineOpportunity } from '@/app/actions/risansi';
import { applyFieldChange,
  OPP_FIELDS, isFieldVisible, requiredFieldNames, labelsFor, stageHasQuote,
} from '@/lib/risansi-opportunity-fields';
import { OppStageSections } from './OppStageSections';
import { QuoteLineItems, emptyItem, itemsAreBlank, type QuoteItem } from './QuoteLineItems';
import { useStateDraft } from './useFormDraft';
import { SaveIndicator, DraftRestoredBanner } from './SaveIndicator';
import { useCloseGuard, CloseX, CloseConfirm, KeepOpenHint } from './FormCloseGuard';
import type { FieldValues } from './OppFields';

/** The only stages an opportunity may be raised at. */
const START_STAGES = ['Prospect', 'Suspect', 'Quoted'] as const;
type StartStage = typeof START_STAGES[number];

const START_BLURB: Record<StartStage, string> = {
  Prospect: 'An enquiry has come in.',
  Suspect:  'Parked — budgetary or an expansion further out.',
  Quoted:   'A quotation has already gone out.',
};

// Raising an opportunity.
//
// It may start at Prospect, Suspect or Quoted — the three states something can
// genuinely be in the moment you first hear about it. Not Won or Lost: those are
// outcomes, and a record that claims to have been born Won leaves no trail of
// how it got there.
//
// Picking a stage decides how much is asked. The catalogue knows which fields
// each stage carries, so Prospect asks the enquiry block, Suspect adds why it is
// parked, and Quoted adds the quote header, its line items and the document.
// That is the "fill everything up to that stage" rule, read from one place
// rather than re-encoded in the form.

interface ClientResult {
  id: string; legal_name: string; code: string;
  city: string | null; industry: string | null;
  owner_name: string | null;
}

export interface NewOpportunityModalProps {
  open: boolean;
  onClose: () => void;
  // Pre-filled & locked when launched from Client 360
  lockClient?: boolean;
  clientId?: string;
  clientName?: string;
  clientCode?: string;
  clientIndustry?: string | null;
  clientOwnerName?: string | null;
  /** ₹ per $1 from the settings page — drives the USD sub-text on money fields. */
  usdRate?: number;
}

export function NewOpportunityModal(props: NewOpportunityModalProps) {
  const { open, onClose, lockClient, usdRate = 86 } = props;

  const lockedClient: ClientResult | null = lockClient && props.clientId
    ? {
        id: props.clientId,
        legal_name: props.clientName ?? '',
        code: props.clientCode ?? '',
        city: null,
        industry: props.clientIndustry ?? null,
        owner_name: props.clientOwnerName ?? null,
      }
    : null;

  const [selected, setSelected] = useState<ClientResult | null>(lockedClient);
  const [search, setSearch]     = useState('');
  const [results, setResults]   = useState<ClientResult[]>([]);

  useEffect(() => { if (open && lockedClient) setSelected(lockedClient); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, props.clientId]);

  // Out-of-order guard: typing quickly fires several searches and the slowest
  // must not overwrite the newest.
  const seq = useRef(0);
  useEffect(() => {
    if (!open || lockClient) return;
    const term = search.trim();
    if (term.length < 2) { setResults([]); return; }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      fetch(`/api/risansi/clients-search?q=${encodeURIComponent(term)}`)
        .then(r => r.ok ? r.json() : [])
        .then((rows: ClientResult[]) => { if (mine === seq.current) setResults(rows.slice(0, 10)); })
        .catch(() => { if (mine === seq.current) setResults([]); });
    }, 220);
    return () => clearTimeout(t);
  }, [search, open, lockClient]);

  const reset = () => { onClose(); setSearch(''); setResults([]); if (!lockClient) setSelected(null); };

  // The form below reports whether anything has been filled in; this parent owns
  // the × and Escape, so it has to know before it closes on either.
  const [dirty, setDirty] = useState(false);
  const guard = useCloseGuard({ dirty, onClose: reset, enabled: open });

  if (!open) return null;

  return (
    <div onClick={guard.onBackdropClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(10,22,40,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
      <div className="risansi-modal" role="dialog" aria-modal="true" style={{
        width: 880, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto',
        background: 'var(--bg-paper)', color: 'var(--fg)', borderRadius: 12,
        boxShadow: '0 24px 64px rgba(10,61,143,0.25)',
      }}>
        {/* Sticky with the header, so there is always a deliberate way out that
            is not a scroll to the bottom — and is not a click on the backdrop,
            which no longer discards a form someone has started filling in. */}
        <div style={{ padding: '16px 20px', background: 'var(--accent-fill)', color: 'var(--on-accent)', position: 'sticky', top: 0, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>New Opportunity</div>
              <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 3 }}>
                Choose where it starts — everything up to that stage is asked here
              </div>
            </div>
            <CloseX onClick={guard.requestClose} tone="onDark" title="Close this form" />
          </div>
          {guard.asking && (
            <CloseConfirm
              tone="onDark"
              message="Close without creating it? What you typed is kept and comes back when you reopen the form."
              onConfirm={guard.confirmClose}
              onCancel={guard.keepEditing}
            />
          )}
          {guard.hint && !guard.asking && <KeepOpenHint tone="onDark" />}
        </div>

        <div style={{ padding: '18px 20px' }}>
          {!selected ? (
            <ClientPicker
              search={search} setSearch={setSearch} results={results}
              onPick={setSelected} onCancel={reset}
            />
          ) : (
            <NewOppForm
              client={selected} lockClient={!!lockClient} usdRate={usdRate}
              onBack={() => { if (!lockClient) { setSelected(null); setResults([]); } }}
              onSuccess={reset}
              onCancel={guard.requestClose}
              onDirtyChange={setDirty}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ClientPicker({ search, setSearch, results, onPick, onCancel }: {
  search: string; setSearch: (v: string) => void;
  results: ClientResult[]; onPick: (c: ClientResult) => void; onCancel: () => void;
}) {
  return (
    <div>
      <label style={LBL}>Client</label>
      <input
        autoFocus value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search by name or client code — at least 2 characters"
        style={INPUT}
      />
      {results.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
          {results.map(c => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c)} style={ROW}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{c.legal_name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{c.code}</span>
                  {c.city ? ` · ${c.city}` : ''}{c.industry ? ` · ${c.industry}` : ''}
                  {c.owner_name ? ` · ${c.owner_name}` : ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {search.trim().length >= 2 && results.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 10 }}>No client matches that.</div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" onClick={onCancel} style={GHOST}>Cancel</button>
      </div>
    </div>
  );
}

function NewOppForm({ client, lockClient, usdRate, onBack, onSuccess, onCancel, onDirtyChange }: {
  client: ClientResult; lockClient: boolean; usdRate: number;
  onBack: () => void; onSuccess: () => void;
  /** Routed through the parent's close guard, which asks before walking away. */
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [stage, setStage]   = useState<StartStage>('Prospect');
  const [values, setValues] = useState<FieldValues>({});
  const [items, setItems]   = useState<QuoteItem[]>([emptyItem()]);
  const [pdfs, setPdfs]     = useState<File[]>([]);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  const onChange = useCallback((name: string, value: string) => {
    setValues(v => applyFieldChange(v, name, value));
    setError('');
  }, []);

  // Kept per client, because that is what makes two half-raised enquiries
  // different pieces of work. The attached PDFs are deliberately not in here:
  // a File cannot survive a page reload, and a draft that silently dropped them
  // would be worse than one that says it keeps the typing.
  const draft = useStateDraft(
    `risansi:opp-draft:new:${client.id}`,
    { stage, values, items },
    {
      onRestore: d => {
        if (d.stage && (START_STAGES as readonly string[]).includes(d.stage)) setStage(d.stage);
        if (d.values) setValues(d.values);
        if (Array.isArray(d.items) && d.items.length) setItems(d.items);
      },
    },
  );

  // The × and Escape live on the modal header above, so dirtiness has to travel
  // up. Reported through a ref so a parent that re-creates the callback on every
  // render cannot turn this into a loop.
  const report = useRef(onDirtyChange);
  useEffect(() => { report.current = onDirtyChange; });
  useEffect(() => { report.current?.(draft.dirty); }, [draft.dirty]);
  // On the way out — a different client picked, or the modal closed — the form
  // is gone and the parent must stop treating it as half-filled.
  useEffect(() => () => report.current?.(false), []);

  const required = requiredFieldNames(stage);
  const missing  = required.filter(n => !values[n]?.trim());

  const submit = async () => {
    if (missing.length) {
      setError(`Fill the required field${missing.length > 1 ? 's' : ''}: ${labelsFor(missing).join(', ')}.`);
      return;
    }
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.set('client_id', client.id);
      fd.set('stage', stage);
      // Everything visible at the chosen stage, not just the last block — the
      // whole point of picking Quoted is that the enquiry answers come too.
      for (const f of OPP_FIELDS) {
        if (isFieldVisible(f, stage, values)) fd.set(f.name, values[f.name] ?? '');
        else if (f.showWhen) fd.set(f.name, '');
      }
      if (stageHasQuote(stage) && !itemsAreBlank(items)) {
        fd.set('items_json', JSON.stringify(items));
      }

      // A refusal comes back as a value. Thrown server-action errors are
      // redacted in production, so every reason this could fail — a missing
      // required field, a client with no rep, a future date — used to arrive as
      // the same "Could not create the opportunity." and told nobody anything.
      const created = await createPipelineOpportunity(fd);
      if (!created.ok) { setError(created.error); setBusy(false); return; }

      // The quotation PDF has nowhere to go until the row exists. The record is
      // saved by this point, so a failed upload must say so plainly rather than
      // reading as though the whole thing was lost.
      const newId = created.id;
      if (pdfs.length && newId) {
        const failed: string[] = [];
        for (const f of pdfs) {
          try {
            const pf = new FormData();
            pf.set('file', f);
            const up = await fetch(`/api/risansi/opportunities/${newId}/quotation`, { method: 'POST', body: pf });
            if (!up.ok) {
              const j = await up.json().catch(() => ({} as { error?: string }));
              failed.push(`${f.name} — ${j?.error || (up.status === 413 ? 'too large' : `failed (${up.status})`)}`);
            }
          } catch { failed.push(`${f.name} — network error`); }
        }
        if (failed.length) {
          window.alert(
            `Opportunity created, but ${failed.length} document(s) could not be attached:\n\n`
            + `${failed.join('\n')}\n\nAdd them from the opportunity card.`,
          );
        }
      }

      // On record now, so the local copy has served its purpose.
      draft.clear();
      onSuccess();
      router.refresh();
    } catch (err) {
      // Anything reaching here is a genuine fault rather than a rule the filer
      // broke — those are returned above. Its message is redacted in production,
      // which is why this one stays generic.
      const raw = err instanceof Error ? err.message : '';
      const redacted = !raw || /unexpected response/i.test(raw) || Boolean((err as { digest?: string })?.digest);
      setError(redacted ? 'Could not create the opportunity — something failed on the server.' : raw);
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap',
        padding: '9px 12px', borderRadius: 8, background: 'var(--bg-elev)', border: '1px solid var(--line)',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{client.legal_name}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{client.code}</div>
        </div>
        {!lockClient && (
          <button type="button" onClick={onBack} style={{ ...LINK, marginLeft: 'auto' }}>Change</button>
        )}
        <span style={{ marginLeft: lockClient ? 'auto' : 10, display: 'inline-flex' }}>
          <SaveIndicator state={draft.state} at={draft.savedAt} />
        </span>
      </div>

      {draft.restored && (
        <DraftRestoredBanner
          what="opportunity you had started"
          onDismiss={draft.dismissRestored}
          onDiscard={draft.discard}
        />
      )}

      <StagePicker value={stage} onChange={setStage} />

      {/* create mode: nothing precedes this record, so every field up to the
          chosen stage is open rather than shown as read-only context. */}
      <OppStageSections
        stage={stage} values={values} onChange={onChange}
        usdRate={usdRate} mode="create"
      >
        {stageHasQuote(stage) && (
          <>
            <QuoteLineItems items={items} onChange={setItems} />
            <QuotationPicker files={pdfs} onChange={setPdfs} />
          </>
        )}
      </OppStageSections>

      {error && <div style={ERR}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" onClick={onCancel} disabled={busy} style={GHOST}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={{ ...PRIMARY, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Creating…' : 'Create Opportunity'}
        </button>
      </div>
    </div>
  );
}

function StagePicker({ value, onChange }: { value: StartStage; onChange: (s: StartStage) => void }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={LBL}>Starting stage</label>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${START_STAGES.length}, 1fr)`, gap: 8 }}>
        {START_STAGES.map(s => {
          const on = s === value;
          return (
            <button
              key={s} type="button" onClick={() => onChange(s)}
              aria-pressed={on}
              style={{
                textAlign: 'left', padding: '9px 11px', borderRadius: 7, cursor: 'pointer',
                fontFamily: 'inherit',
                border: `1px solid ${on ? 'var(--title)' : 'var(--line-strong)'}`,
                background: on ? 'var(--accent-soft)' : 'var(--bg-paper)',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700, color: on ? 'var(--title)' : 'var(--fg)' }}>{s}</div>
              <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 2, lineHeight: 1.35 }}>
                {START_BLURB[s]}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuotationPicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ marginTop: 12 }}>
      <label style={LBL}>Quotation document</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          ref={ref} type="file" accept="application/pdf,.pdf" multiple style={{ display: 'none' }}
          onChange={e => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = '';
            onChange([...files, ...picked.filter(p => !files.some(f => f.name === p.name && f.size === p.size))]);
          }}
        />
        <button type="button" onClick={() => ref.current?.click()} style={{ ...GHOST, padding: '7px 12px', fontSize: 12 }}>
          ⤒ Attach PDF
        </button>
        <span style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>
          PDF only · uploaded once the opportunity is saved
        </span>
      </div>
      {files.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map(f => (
            <li key={`${f.name}:${f.size}`} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '4px 9px', borderRadius: 6,
              background: 'var(--bg-elev)', border: '1px solid var(--line)',
            }}>
              <span style={{ fontSize: 11.5, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                📄 {f.name}
              </span>
              <button
                type="button" style={{ ...LINK, marginLeft: 'auto', color: 'var(--neg)' }}
                onClick={() => onChange(files.filter(x => !(x.name === f.name && x.size === f.size)))}
              >Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const LBL: CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 5,
};
const INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 13,
  fontFamily: 'inherit', background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg)', outline: 'none',
};
const ROW: CSSProperties = {
  width: '100%', textAlign: 'left', border: 'none', background: 'none',
  padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit',
  borderBottom: '1px solid var(--line-2)',
};
const GHOST: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 13, fontWeight: 600, padding: '9px 16px', cursor: 'pointer', fontFamily: 'inherit',
};
const PRIMARY: CSSProperties = {
  border: 'none', background: 'var(--accent-fill)', color: 'var(--on-accent)', borderRadius: 6,
  fontSize: 13, fontWeight: 600, padding: '9px 18px', cursor: 'pointer', fontFamily: 'inherit',
};
const LINK: CSSProperties = {
  background: 'none', border: 'none', color: 'var(--brand-blue)', cursor: 'pointer',
  fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', textDecoration: 'underline',
};
const ERR: CSSProperties = {
  marginTop: 14, padding: '9px 12px', background: 'var(--neg-soft)',
  border: '1px solid var(--neg)', borderLeft: '3px solid var(--neg)',
  borderRadius: 6, color: 'var(--neg-strong)', fontSize: 12, lineHeight: 1.5,
};
