'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { updateOpportunity } from '@/app/actions/risansi';
import { addOpportunityRemark } from '@/app/actions/risansi-opportunity-remarks';
import { applyFieldChange,
  OPP_FIELDS, isFieldVisible, requiredFieldNames, labelsFor, stageHasQuote,
  DROP_REASONS, LOST_COMPETITOR_TAIL, REMARK_STAGES, REMARK_LABEL, STAGE_HINT,
  type OppStage, type OppFieldDef,
} from '@/lib/risansi-opportunity-fields';
import { OppStageSections } from './OppStageSections';
import { useCompetitors } from './useCompetitors';
import { QuoteLineItems, emptyItem, itemsAreBlank, type QuoteItem } from './QuoteLineItems';
import { SalesOrderList, type SoRow } from './SalesOrderList';
import { useQuotationDocs, QuotationDocList, type UploadResponse } from './QuotationDocs';
import { useStateDraft } from './useFormDraft';
import { SaveIndicator, DraftRestoredBanner } from './SaveIndicator';
import { useCloseGuard, CloseX, CloseConfirm, KeepOpenHint } from './FormCloseGuard';
import type { FieldValues } from './OppFields';

// Moving an opportunity to its next stage.
//
// One form for every destination, replacing the two that grew separately: a
// Quoted-only modal and a Won/Lost/Dropped one, each with its own copy of the
// field list and its own idea of what was required. The catalogue decides what
// this stage asks; this component only decides what it attaches — line items and
// documents at Quoted, sales orders at Won.

export interface MoveOpp {
  id: string | number;
  client_name?: string;
  client_code?: string;
  stage: string;
  value_cr?: number | string | null;
  final_value_cr?: number | string | null;
  [k: string]: unknown;
}

const inrOf = (cr: unknown) =>
  cr != null && cr !== '' ? String(Math.round(parseFloat(String(cr)) * 10_000_000)) : '';

export function OppStageMoveModal({ opp, target, usdRate = 86, onCancel, onDone }: {
  opp: MoveOpp;
  target: OppStage;
  usdRate?: number;
  onCancel: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const oppId = Number(opp.id);

  // Whether to draw the quotation block at all.
  //
  // stageHasQuote is true for every stage from Quoted onward, Dropped included —
  // correct for the catalogue, since a dropped deal that WAS quoted still owns
  // its quote. But an enquiry regretted straight from Prospect was never quoted,
  // and showing it line items and a document upload is noise at the moment
  // someone is closing it off. So the target decides, and the record gets a veto.
  const everQuoted = Boolean(String(opp.quote_ref ?? '').trim());
  const showQuote = stageHasQuote(target) && (target === 'Quoted' || everQuoted);

  // Seed every field visible at the destination from what the record already
  // holds, so the context section shows the deal rather than a row of blanks.
  //
  // Visibility here is by stage only — no `values` argument. This initializer
  // IS what creates `values`, and reading it from inside threw a ReferenceError
  // on the form's first render for a day (the generic "Something went wrong"
  // page on every move to Quoted). A conditional field is seeded regardless;
  // the form hides it when its condition is not met and submit sends '' for it.
  const [values, setValues] = useState<FieldValues>(() => {
    const v: FieldValues = {};
    for (const f of OPP_FIELDS) {
      if (!isFieldVisible(f, target)) continue;
      if (f.name === 'final_value_inr') { v[f.name] = inrOf(opp.final_value_cr ?? opp.value_cr); continue; }
      if (f.name === 'offer_value_inr') { v[f.name] = opp.offer_value_inr != null ? String(opp.offer_value_inr) : ''; continue; }
      const raw = opp[f.name];
      v[f.name] = raw == null ? '' : String(raw);
    }
    return v;
  });

  const [items, setItems]   = useState<QuoteItem[]>([emptyItem()]);
  const [remark, setRemark] = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');
  // The sales-order rows a Won move asks for. SalesOrderList owns them and
  // sends them through a hidden input; this copy exists only so the draft can
  // keep them, and `soSeed` is how a restored draft gets back into it.
  // `n` is a remount counter: SalesOrderList seeds itself once from initialRows,
  // so putting drafted rows back into it (or clearing them again on a discard)
  // means giving it a new key.
  const [soSeed, setSoSeed] = useState<{ rows: SoRow[]; n: number }>({ rows: [], n: 0 });
  const [soRows, setSoRows] = useState<SoRow[]>([]);

  const onChange = useCallback((name: string, value: string) => {
    setValues(v => applyFieldChange(v, name, value));
    setError('');
  }, []);

  // Existing line items, so a re-quote edits them rather than starting over.
  //
  // `seeded` tells the draft when this is finished: until then a loaded quote
  // would look to it like fields someone had just typed, and every re-quote
  // would open claiming unsaved changes.
  const [seeded, setSeeded] = useState(!showQuote);
  // A restored draft outranks the server's lines — it is the newer edit of them.
  const draftApplied = useRef(false);
  useEffect(() => {
    if (!showQuote) return;
    let alive = true;
    fetch(`/api/risansi/opportunities/${oppId}/items`)
      .then(r => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: Record<string, unknown>[] }) => {
        if (!alive || !d.items?.length || draftApplied.current) return;
        setItems(d.items.map(it => ({
          pump_model: String(it.pump_model ?? ''), pump_qty: String(it.pump_qty ?? ''),
          pump_speed: String(it.pump_speed ?? ''), geared_motor_detail: String(it.geared_motor_detail ?? ''),
          motor_price: String(it.motor_price ?? ''), gearbox_vbelt_price: String(it.gearbox_vbelt_price ?? ''),
          offer_value_inr: String(it.offer_value_inr ?? ''),
          detailed_specifications: String(it.detailed_specifications ?? ''),
        })));
      })
      .catch(() => {})
      // Whether the lines arrived or the fetch failed, the form is as seeded as
      // it is going to get, so the draft must not wait on it any longer.
      .finally(() => { if (alive) setSeeded(true); });
    return () => { alive = false; };
  }, [oppId, showQuote]);

  // Keep what is typed, keyed by the deal AND the destination: the same
  // opportunity being moved to Dropped is a different piece of work from the
  // same one being moved to Won, and one must not restore into the other.
  const draft = useStateDraft(
    Number.isFinite(oppId) ? `risansi:opp-draft:move:${oppId}:${target}` : null,
    { values, items, remark, soRows },
    {
      ready: seeded,
      onRestore: d => {
        draftApplied.current = true;
        if (d.values) setValues(d.values);
        if (Array.isArray(d.items) && d.items.length) setItems(d.items);
        setRemark(d.remark ?? '');
        setSoSeed(s => ({ rows: Array.isArray(d.soRows) ? d.soRows : [], n: s.n + 1 }));
      },
    },
  );

  // The two lists the catalogue cannot hold, because they come from the database
  // and from a constant that would otherwise be duplicated here. The competitor
  // list is loaded here rather than passed in, so this picker and the drawer's
  // cannot end up offering different things.
  const competitors = useCompetitors();
  const optionsFor = (f: OppFieldDef) =>
    f.name === 'drop_reason' ? DROP_REASONS
    : f.name === 'lost_to_competitor' ? [...competitors, ...LOST_COMPETITOR_TAIL]
    : undefined;

  // Uploading the quotation reads it and fills what is still blank — the one
  // genuinely useful thing the old Quoted modal did, kept rather than lost with
  // it. Blanks only: nothing already typed is overwritten, so attaching a second
  // document can complete an earlier one without undoing it.
  const [filled, setFilled] = useState(0);
  const absorb = useCallback((data: UploadResponse) => {
    const meta = data.meta ?? {};
    const keys = ['quote_ref', 'quote_date', 'enquiry_no', 'enquiry_date', 'product_type', 'market', 'offer_value_inr'];
    let n = 0;
    setValues(cur => {
      const next = { ...cur };
      for (const k of keys) {
        const v = meta[k];
        if (v != null && v !== '' && !next[k]?.trim()) { next[k] = String(v); n++; }
      }
      return next;
    });
    const parsed = Array.isArray(data.items) ? data.items : [];
    setItems(cur => (parsed.length && itemsAreBlank(cur)
      ? parsed.map(it => ({
          pump_model: String(it.pump_model ?? ''), pump_qty: String(it.pump_qty ?? ''),
          pump_speed: String(it.pump_speed ?? ''), geared_motor_detail: String(it.geared_motor_detail ?? ''),
          motor_price: String(it.motor_price ?? ''), gearbox_vbelt_price: String(it.gearbox_vbelt_price ?? ''),
          offer_value_inr: String(it.offer_value_inr ?? ''),
          detailed_specifications: String(it.detailed_specifications ?? ''),
        }))
      : cur));
    setFilled(f => f + n);
  }, []);

  const docs = useQuotationDocs(oppId, {
    enabled: showQuote,
    onParsed: data => absorb(data),
  });

  const missing = requiredFieldNames(target).filter(n => !values[n]?.trim());

  const submit = async () => {
    if (missing.length) {
      setError(`Fill the required field${missing.length > 1 ? 's' : ''}: ${labelsFor(missing).join(', ')}.`);
      return;
    }
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.set('stage', target);
      for (const f of OPP_FIELDS) {
        if (isFieldVisible(f, target, values)) fd.set(f.name, values[f.name] ?? '');
        else if (f.showWhen) fd.set(f.name, '');
      }
      if (showQuote && !itemsAreBlank(items)) fd.set('items_json', JSON.stringify(items));
      // SalesOrderList writes its rows into a hidden input of this name.
      const so = document.querySelector<HTMLInputElement>('input[name="sales_orders_json"]');
      if (so) fd.set('sales_orders_json', so.value);

      const res = await updateOpportunity(oppId, fd);
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      // The remark is its own row, so a failure here must not read as the move
      // having failed — the stage change is already committed at this point.
      if (remark.trim()) {
        // Deliberately not surfaced: the move has already been committed, so a
        // refusal here must not read as the move having failed. It is logged
        // rather than silently dropped.
        const rr = await addOpportunityRemark(oppId, target, remark).catch(() => null);
        if (rr && !rr.ok) console.error('[OppStageMoveModal] remark not saved:', rr.error);
      }
      // The move is on record, so the local copy of it has served its purpose.
      // Left behind, it would be offered back the next time this deal was moved.
      draft.clear();
      onDone();
      router.refresh();
    } catch (e) {
      // Refusals now arrive as a returned value, so anything reaching here is a
      // genuine fault rather than a rule the mover broke — and its message is
      // redacted in production, which is why this stays generic.
      const raw = e instanceof Error ? e.message : '';
      const redacted = !raw || /unexpected response/i.test(raw) || Boolean((e as { digest?: string })?.digest);
      setError(redacted ? `Could not move this opportunity to ${target}.` : raw);
      setBusy(false);
    }
  };

  const wantsRemark = REMARK_STAGES.includes(target);

  // Closing this form used to be a trap: a backdrop click threw away a long
  // quotation, and there was no × anywhere in the header to close it on purpose.
  const guard = useCloseGuard({ dirty: draft.dirty, onClose: onCancel, enabled: !busy });

  return (
    <div onClick={guard.onBackdropClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 420, background: 'rgba(10,22,40,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
      <div className="risansi-modal" role="dialog" aria-modal="true" style={{
        width: 880, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto',
        background: 'var(--bg-paper)', color: 'var(--fg)', borderRadius: 12,
        boxShadow: '0 24px 64px rgba(10,61,143,0.25)',
      }}>
        {/* Sticky, so the × and the draft indicator stay in reach however long
            the stage's field list is. The Cancel at the foot of the form was the
            only way out before, which is a scroll away on every long quotation. */}
        <div style={{ padding: '16px 20px', background: 'var(--accent-fill)', color: 'var(--on-accent)', position: 'sticky', top: 0, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                {opp.stage} → {target}
              </div>
              <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 3 }}>
                {opp.client_name}{opp.client_code ? ` · ${opp.client_code}` : ''} — {STAGE_HINT[target]}
              </div>
            </div>
            <CloseX onClick={guard.requestClose} tone="onDark" title="Close this form" />
          </div>
          {/* On its own line rather than beside the heading: at 375px the two
              together squeezed the stage names onto three lines. */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
            <SaveIndicator state={draft.state} at={draft.savedAt} tone="onDark" />
          </div>
          {guard.asking && (
            <CloseConfirm
              tone="onDark"
              message="Close without moving this deal? What you typed is kept and comes back when you reopen it."
              onConfirm={guard.confirmClose}
              onCancel={guard.keepEditing}
            />
          )}
          {guard.hint && !guard.asking && <KeepOpenHint tone="onDark" />}
        </div>

        <div style={{ padding: '18px 20px' }}>
          {draft.restored && (
            <DraftRestoredBanner
              what={`move to ${target}`}
              onDismiss={draft.dismissRestored}
              onDiscard={draft.discard}
            />
          )}
          <OppStageSections
            stage={target} values={values} onChange={onChange}
            usdRate={usdRate} optionsFor={optionsFor}
          >
            {showQuote && (
              <>
                <QuoteLineItems items={items} onChange={setItems} />
                <div style={{ marginTop: 12 }}>
                  <label style={LBL}>Quotation documents</label>
                  <QuotationDocList
                    oppId={oppId} docs={docs.docs} loading={docs.loading} busy={docs.busy}
                    canEdit onRemove={docs.remove} loadError={docs.loadError}
                    emptyText="No documents attached yet."
                  />
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                    <label style={{ ...GHOST, padding: '7px 12px', fontSize: 12, cursor: docs.busy ? 'wait' : 'pointer' }}>
                      {docs.busy ? 'Reading…' : '⤒ Upload PDF'}
                      <input
                        type="file" accept="application/pdf,.pdf" multiple disabled={docs.busy}
                        style={{ display: 'none' }}
                        onChange={async e => {
                          const picked = Array.from(e.target.files ?? []);
                          e.target.value = '';
                          setFilled(0);
                          await docs.upload(picked);
                        }}
                      />
                    </label>
                    <span style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>
                      {docs.msg
                        ? `${docs.msg}${!docs.err && filled > 0 ? ` Filled ${filled} blank field${filled === 1 ? '' : 's'} — check before saving.` : ''}`
                        : 'Uploading reads the quote and fills anything still blank'}
                    </span>
                  </div>
                </div>
              </>
            )}
            {target === 'Won' && (
              <div style={{ marginTop: 12 }}>
                <SalesOrderList
                  key={`so-${soSeed.n}`}
                  initialRows={soSeed.rows.length ? soSeed.rows : undefined}
                  onRowsChange={setSoRows}
                  finalValueInr={parseFloat(values.final_value_inr || '') || null}
                />
              </div>
            )}
          </OppStageSections>

          {wantsRemark && (
            <div style={{ marginTop: 16 }}>
              <label style={LBL}>{REMARK_LABEL[target] ?? 'Remarks'}</label>
              <textarea
                value={remark} onChange={e => setRemark(e.target.value)} rows={3}
                placeholder="What happened, and what next? Kept against this stage."
                style={{ ...INPUT, height: 'auto', resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>
          )}

          {error && <div style={ERR}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" onClick={guard.requestClose} disabled={busy} style={GHOST}>Cancel</button>
            <button type="button" onClick={submit} disabled={busy} style={{ ...PRIMARY, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Saving…' : `Move to ${target}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const LBL: CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4,
};
const INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13,
  fontFamily: 'inherit', background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg)', outline: 'none',
};
const GHOST: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 13, fontWeight: 600, padding: '9px 16px', cursor: 'pointer', fontFamily: 'inherit',
};
const PRIMARY: CSSProperties = {
  border: 'none', background: 'var(--accent-fill)', color: 'var(--on-accent)', borderRadius: 6,
  fontSize: 13, fontWeight: 600, padding: '9px 18px', cursor: 'pointer', fontFamily: 'inherit',
};
const ERR: CSSProperties = {
  marginTop: 14, padding: '9px 12px', background: 'var(--neg-soft)',
  border: '1px solid var(--neg)', borderLeft: '3px solid var(--neg)',
  borderRadius: 6, color: 'var(--neg-strong)', fontSize: 12, lineHeight: 1.5,
};
