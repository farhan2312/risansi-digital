'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { STAGE_TONE } from '@/lib/risansi-stage-tone';
import { useRouter } from 'next/navigation';
import { OfferRevisionsList } from './OfferRevisionsField';
import { useCompetitors } from './useCompetitors';
import type { OfferRevision } from '@/lib/risansi-offer-revisions';
import { updateOpportunity, deleteOpportunity, saveQuotedItems } from '@/app/actions/risansi';
import { QuoteLineItems, emptyItem, type QuoteItem as LineItem } from './QuoteLineItems';
import { probabilityCodeDisplay } from '@/lib/risansi-probability-codes';
import { applyFieldChange,
  DROP_REASONS, LOST_COMPETITOR_TAIL, OPP_FIELDS, isFieldVisible,
  type OppStage, type OppFieldDef,
} from '@/lib/risansi-opportunity-fields';
import { OppStageSections } from './OppStageSections';
import type { FieldValues } from './OppFields';

import { MonthYearSelect } from './MonthYearSelect';
import { OppStageMoveModal } from './OppStageMoveModal';
import { SalesOrderManager } from './SalesOrderManager';
import { PurchaseOrderManager } from './PurchaseOrderManager';
import { QuotationPdfManager } from './QuotationPdfManager';
import { QuotationLinkView } from './QuotationLinkView';
import { ChangeOppClient } from './ChangeOppClient';
import { OppRemarksLog } from './OppRemarksLog';
import { useStateDraft } from './useFormDraft';
import { SaveIndicator, DraftRestoredBanner } from './SaveIndicator';
import { useCloseGuard, CloseX, CloseConfirm, KeepOpenHint } from './FormCloseGuard';

/** Crores → the whole rupee figure the money inputs take. */
const inrOfCr = (cr: unknown) =>
  cr != null && cr !== '' ? String(Math.round(parseFloat(String(cr)) * 10_000_000)) : '';


// A quotation exists from Quoted onward — the PDF can be viewed/replaced/deleted
// at any of these stages (even a locked Won/Lost, if the viewer may edit).
const QUOTED_PLUS = ['Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped'];

export interface EditableOpp {
  id: string;
  client_id?: string;
  client_name: string;
  client_code: string;
  rep_name?: string | null;
  product: string;
  product_type?: string | null;
  unit_project?: string | null;
  stage: string;
  value_cr: number;
  probability?: number | null;
  probability_code?: string | null;
  eta_text?: string | null;
  quote_ref?: string | null;
  quote_date?: string | null;
  negotiation_notes?: string | null;
  notes?: string | null;
  rep_id?: number | null;
  auto_created?: boolean | null;
  auto_source?: string | null;
  po_number?: string | null;
  final_value_cr?: number | string | null;
  lost_to_competitor?: string | null;
  lost_reason?: string | null;
  drop_reason?: string | null;
  quotation_link?: string | null;
  // The intake block and per-stage reasons (migration 0061). The board and the
  // move form read these; SELECT o.* already carries them.
  opportunity_type?: string | null;
  opportunity_source?: string | null;
  opportunity_category?: string | null;
  client_reference?: string | null;
  suspect_reason?: string | null;
  hold_reason?: string | null;
  po_date?: string | null;
  enquiry_no?: string | null;
  enquiry_date?: string | null;
  market?: string | null;
  offer_value_inr?: number | string | null;
  tour_name?: string | null;
  tour_people?: string | null;   // all reps + manager on the client's tour
}

interface QItem { id: number; pump_model: string | null; pump_qty: number | null; pump_speed: string | null; geared_motor_detail: string | null; motor_price: number | null; gearbox_vbelt_price: number | null; offer_value_inr: number | null; detailed_specifications: string | null; }
interface QMeta { market?: string | null; ril_rep?: string | null; qtn_prepared_by?: string | null; client_status_at_quote?: string | null; unit_project?: string | null; location?: string | null; qtr?: string | null; probability_code?: string | null; enquiry_no?: string | null; enquiry_date?: string | null; revised_offer_date?: string | null; revised_offer_value_inr?: number | null; offer_value_inr?: number | null; quotation_link?: string | null; }


export function EditOppDrawer({ opp, onClose, canEdit = true, usdRate = 86 }: {
  opp: EditableOpp; onClose: () => void; canEdit?: boolean; usdRate?: number;
}) {
  const router = useRouter();
  // Loaded here rather than passed in. As a prop it was optional with an empty
  // default, and the active-opportunities table renders this drawer without it —
  // so Lost To Competitor offered four generic fallbacks and no competitor.
  const competitors = useCompetitors();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  // The stage shown in the strip is always the record's own. Picking a
  // different one does not change it here: it opens the move form — the same
  // one a drag on the board opens — which asks for everything that stage needs,
  // line items and the quotation document included. This form used to let you
  // click Quoted and Save, which asked for the quote number and the offer but
  // never the specifications or the per-line values, so a quote arrived on the
  // board with no lines under it.
  const stage = opp.stage;
  const [moveTo, setMoveTo] = useState<OppStage | null>(null);
  const [quoteItems, setQuoteItems] = useState<QItem[]>([]);
  const [quoteMeta, setQuoteMeta]   = useState<QMeta | null>(null);
  const [revisions, setRevisions]   = useState<OfferRevision[]>([]);
  // Seeded SYNCHRONOUSLY from the opp row, which carries every field via
  // SELECT o.*. Seeding from the async quote-meta fetch instead would let an
  // early save write a blank over a stored value before the fetch resolved.
  //
  // Controlled, because OppStageSections renders controlled inputs. The form
  // relied on new FormData(e.currentTarget), which cannot see a value the shared
  // field components hold in state.
  const [values, setValues] = useState<FieldValues>(() => {
    const v: FieldValues = {};
    for (const f of OPP_FIELDS) {
      if (f.name === 'final_value_inr') { v[f.name] = inrOfCr(opp.final_value_cr ?? opp.value_cr); continue; }
      if (f.name === 'offer_value_inr') { v[f.name] = opp.offer_value_inr != null ? String(opp.offer_value_inr) : ''; continue; }
      const raw = (opp as unknown as Record<string, unknown>)[f.name];
      v[f.name] = raw == null ? '' : String(raw);
    }
    return v;
  });
  const setValue = (name: string, value: string) =>
    setValues(v => applyFieldChange(v, name, value));
  const optionsFor = (f: OppFieldDef) =>
    f.name === 'drop_reason' ? DROP_REASONS
    : f.name === 'lost_to_competitor' ? [...competitors, ...LOST_COMPETITOR_TAIL]
    : undefined;
  // Load the quoted items + quote-level attributes for the read view. Bumping
  // itemsVersion reloads them after an inline edit of the lines.
  const [itemsVersion, setItemsVersion] = useState(0);
  useEffect(() => {
    let active = true;
    fetch(`/api/risansi/opportunities/${opp.id}/items`)
      .then(r => (r.ok ? r.json() : { items: [], meta: null }))
      .then(d => { if (active) { setQuoteItems(d.items ?? []); setQuoteMeta(d.meta ?? null); setRevisions(Array.isArray(d.revisions) ? d.revisions : []); } })
      .catch(() => {});
    return () => { active = false; };
  }, [opp.id, itemsVersion]);

  const isLocked = opp.stage === 'Won' || opp.stage === 'Lost';
  // View-only when locked (Won/Lost) OR the viewer lacks edit rights.
  const readOnly = isLocked || !canEdit;

  // An edit in progress, kept locally so that closing the drawer — by any
  // route, including the stray backdrop click this used to close on — never
  // throws the typing away. A read-only drawer has nothing to keep.
  const draft = useStateDraft(
    `risansi:opp-draft:edit:${opp.id}`,
    { values },
    { enabled: !readOnly, onRestore: d => { if (d.values) setValues(d.values); } },
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const fd = new FormData(e.currentTarget);
      // The catalogue fields live in state, so they are written in by hand.
      // Anything still rendered as a native input — the sales-order list — is
      // already in fd from the form element.
      fd.set('stage', stage);
      for (const f of OPP_FIELDS) {
        if (isFieldVisible(f, stage as OppStage, values)) fd.set(f.name, values[f.name] ?? '');
        else if (f.showWhen) fd.set(f.name, '');
      }
      // Ownership is derived from the client's tour, not set here — the form
      // sends no rep_id, and updateOpportunity leaves the existing owner intact.
      // A refusal comes back as a value, not an exception: a thrown server-action
      // error is redacted in production and the reason never reaches the screen.
      const res = await updateOpportunity(Number(opp.id), fd);
      if (!res.ok) { setError(res.error); setLoading(false); return; }
      // Saved for real — keeping the local copy would offer it back on reopen.
      draft.clear();
      router.refresh();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update opportunity');
      setLoading(false);
    }
  };

  // value_cr is stored in Crores; opportunity values are entered/shown as the
  // full rupee amount (1 Cr = ₹10,000,000). inrFrom → raw integer for number
  // inputs; inrLabel → grouped ₹ string for read-only display.
  const inrFrom = (cr: number | string | null | undefined) =>
    cr != null && cr !== '' ? String(Math.round(parseFloat(String(cr)) * 10_000_000)) : '';
  const inrLabel = (cr: number | string | null | undefined) =>
    cr != null && cr !== '' ? '₹' + Math.round(parseFloat(String(cr)) * 10_000_000).toLocaleString('en-IN') : '';

  // Escape is handed to the move form while that is open, so one press does not
  // close both it and the drawer underneath.
  const guard = useCloseGuard({
    dirty: draft.dirty,
    onClose,
    enabled: !loading && moveTo === null,
  });

  const probLabel = probabilityCodeDisplay(opp.probability_code);
  // Static deal facts for a Won opp — shown as a compact grid below the actionable
  // Sales/Purchase Order panels, so the read view leads with what you act on.
  const wonDetails: [string, string][] = [
    ['Product', opp.product],
    ['Product Type', opp.product_type ?? '—'],
    ['Quoted Value', inrLabel(opp.value_cr) || '—'],
    ['Probability', probLabel],
    ['Expected Close', opp.eta_text ?? '—'],
    ['Quote Ref', opp.quote_ref ?? '—'],
    ['Tour', opp.tour_name ?? '—'],
    ['Reps / Manager', opp.tour_people ?? opp.rep_name ?? '—'],
  ];

  return (
    <>
      {/* The backdrop no longer closes a drawer with typing in it: that click
          was how a part-finished edit disappeared. Untouched, it still closes. */}
      <div onClick={guard.onBackdropClick} style={{
        position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)',
        backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', zIndex: 300,
      }} />
      <div className="risansi-modal" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 820, maxWidth: 'calc(100vw - 32px)', maxHeight: '90vh',
        background: 'var(--bg-paper)', borderRadius: 12,
        zIndex: 301, display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(10,61,143,0.2)', overflow: 'hidden',
      }}>
        {/* Header. Sticky by virtue of the flex column: it never scrolls out of
            reach, so the × and the draft indicator are always where they were. */}
        <div style={{ borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{
          padding: '16px 20px 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>
              {readOnly ? 'Opportunity' : 'Edit Opportunity'}
              {/* Which stage this form is currently in. The fields on it change
                  from stage to stage, so "why is it asking me for a PO number"
                  is answered by the pill rather than by scrolling. Reads `stage`
                  rather than opp.stage so it follows the picker as it changes,
                  and shows where it came from when it has. */}
              <span style={{
                marginLeft: 10, verticalAlign: 'middle',
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '2px 9px', borderRadius: 999,
                fontSize: 11, fontWeight: 600, letterSpacing: '0.01em',
                color: STAGE_TONE[stage] ?? 'var(--fg-2)',
                background: `${STAGE_TONE[stage] ?? '#6B7FA3'}1A`,
                border: `1px solid ${STAGE_TONE[stage] ?? '#6B7FA3'}55`,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: STAGE_TONE[stage] ?? '#6B7FA3', flexShrink: 0,
                }} />
                {stage}
                {stage !== opp.stage && (
                  <span style={{ fontWeight: 400, opacity: 0.75 }}>· was {opp.stage}</span>
                )}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {opp.client_name}
              <span style={{ color: 'var(--line-strong)' }}>·</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{opp.client_code}</span>
              {opp.client_id && (
                <a
                  href={`/risansi/clients/${opp.client_id}`}
                  style={{
                    fontSize: 11, color: 'var(--brand-blue)', textDecoration: 'none',
                    padding: '2px 7px', border: '1px solid rgba(26,92,184,0.3)',
                    borderRadius: 4, background: 'var(--accent-soft)',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  View Client →
                </a>
              )}
              {/* Sysadmin only, and renders nothing for anyone else. Sits beside
                  the client it would change, and stays available on a locked
                  Won/Lost deal — a mis-linked closed deal is the case that most
                  needs correcting. */}
              <ChangeOppClient
                oppId={Number(opp.id)}
                currentCode={opp.client_code}
                currentName={opp.client_name}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Everything the portal holds about this one opportunity, as a
                workbook — a plain link, so the browser downloads it without the
                surrounding form noticing a navigation. */}
            <a
              href={`/api/risansi/opportunities/${opp.id}/export`}
              title="Download every detail of this opportunity as Excel"
              style={{
                fontSize: 11.5, fontWeight: 600, color: 'var(--brand-blue)', textDecoration: 'none',
                padding: '5px 10px', border: '1px solid rgba(26,92,184,0.3)',
                borderRadius: 5, background: 'var(--accent-soft)', whiteSpace: 'nowrap',
              }}
            >
              ⤓ Export Excel
            </a>
            <CloseX onClick={guard.requestClose} title="Close this form" />
          </div>
        </div>
        <div style={{ padding: readOnly && !guard.asking && !guard.hint ? '0 20px 16px' : '0 20px 14px' }}>
          {!readOnly && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', minHeight: 14 }}>
              <SaveIndicator state={draft.state} at={draft.savedAt} />
            </div>
          )}
          {guard.asking && (
            <CloseConfirm
              message="Close this edit? What you typed is kept and comes back when you reopen it."
              onConfirm={guard.confirmClose}
              onCancel={guard.keepEditing}
            />
          )}
          {guard.hint && !guard.asking && <KeepOpenHint />}
        </div>
        </div>

        {/* Auto-created notice */}
        {opp.auto_created && (
          <div style={{ padding: '8px 20px', background: 'var(--accent-soft)', borderBottom: '1px solid rgba(26,92,184,0.15)', fontSize: 12, color: 'var(--brand-blue)' }}>
            ⚡ Auto-created from visit
            {opp.auto_source === 'expansion_plan' ? ' (expansion plan)'
              : opp.auto_source === 'displacement' ? ' (competitor displacement)' : ''}
          </div>
        )}

        {/* Lock notice */}
        {isLocked && (
          <div style={{
            padding: '10px 16px',
            background: opp.stage === 'Won' ? 'var(--pos-soft)' : 'var(--neg-soft)',
            borderBottom: '1px solid var(--line)', fontSize: 12,
            color: opp.stage === 'Won' ? 'var(--pos-strong)' : 'var(--neg-strong)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            🔒 This opportunity is {opp.stage} and locked.{opp.stage === 'Won' ? ' The deal is frozen, but you can still record Sales Orders below until they cover the final value.' : ' No further changes can be made.'}
          </div>
        )}

        {/* View-only notice — editable stage, but not the viewer's to edit */}
        {!canEdit && !isLocked && (
          <div style={{
            padding: '10px 16px', background: 'var(--warn-soft)',
            borderBottom: '1px solid var(--line)', fontSize: 12,
            color: 'var(--warn)', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            👁 View only — this opportunity is on the <strong>{opp.tour_name ?? 'client’s'}</strong> tour. Only reps on that tour (or an admin) can edit it.
          </div>
        )}

        {/* Read-only view for locked or view-only opps */}
        {readOnly ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {opp.stage === 'Won' ? (
              <>
                {/* Fulfilment first — the point of a Won opp, so it's never buried.
                    Final value is editable inside the Sales Orders panel; it defaults
                    to the quoted value when no separate final value was recorded. */}
                <SalesOrderManager
                  oppId={Number(opp.id)}
                  finalValueCr={
                    opp.final_value_cr != null && opp.final_value_cr !== ''
                      ? Number(opp.final_value_cr)
                      : (opp.value_cr != null ? Number(opp.value_cr) : null)
                  }
                  canEdit={canEdit}
                />
                {/* Customer POs — a free-standing list (No / Date / Value). */}
                <PurchaseOrderManager oppId={Number(opp.id)} canEdit={canEdit} />

                {/* Deal facts — compact grid, demoted below the actionable panels. */}
                <DetailGrid rows={opp.po_number ? [...wonDetails, ['PO Number', opp.po_number]] : wonDetails} />
                {opp.notes && <ReadOnlyRow label="Notes" value={opp.notes} />}

                {(QUOTED_PLUS.includes(opp.stage) || opp.quotation_link) && (
                  <QuotationPdfManager oppId={Number(opp.id)} initialLink={opp.quotation_link ?? null} canEdit={canEdit} />
                )}
                <QuotedItemsSection items={quoteItems} meta={quoteMeta} revisions={revisions} usdRate={usdRate} />
              </>
            ) : (
              <>
                <ReadOnlyRow label="Stage" value={opp.stage} />
                <ReadOnlyRow label="Product" value={opp.product} />
                <ReadOnlyRow label="Product Type" value={opp.product_type ?? '—'} />
                <ReadOnlyRow label="Value" value={inrLabel(opp.value_cr) || '—'} />
                {opp.stage === 'Lost' && (
                  <>
                    <ReadOnlyRow label="Lost To" value={opp.lost_to_competitor ?? '—'} />
                    <ReadOnlyRow label="Lost Reason" value={opp.lost_reason ?? '—'} />
                  </>
                )}
                {opp.stage === 'Dropped' && (
                  <ReadOnlyRow label="Drop Reason" value={opp.drop_reason ?? '—'} />
                )}
                <ReadOnlyRow label="Probability" value={probLabel} />
                <ReadOnlyRow label="Expected Close" value={opp.eta_text ?? '—'} />
                <ReadOnlyRow label="Quote Ref" value={opp.quote_ref ?? '—'} />
                <ReadOnlyRow label="Tour" value={opp.tour_name ?? '—'} />
                <ReadOnlyRow label="Reps / Manager" value={opp.tour_people ?? opp.rep_name ?? '—'} />
                <ReadOnlyRow label="Notes" value={opp.notes ?? '—'} />
                {(QUOTED_PLUS.includes(opp.stage) || opp.quotation_link) && (
                  <QuotationPdfManager oppId={Number(opp.id)} initialLink={opp.quotation_link ?? null} canEdit={canEdit} />
                )}
                <QuotedItemsSection items={quoteItems} meta={quoteMeta} revisions={revisions} usdRate={usdRate} />
              </>
            )}
            {/* Last, because it is history rather than something to act on. */}
            <OppRemarksLog oppId={Number(opp.id)} />
          </div>
        ) : (
        /* Editable form */
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {draft.restored && (
              <DraftRestoredBanner
                what="edits to this opportunity"
                onDismiss={draft.dismissRestored}
                onDiscard={draft.discard}
              />
            )}

            {/* Stage — the record's own; any other pill opens the move form */}
            <div>
              <label style={LABEL_STYLE}>Stage *</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped'].map(s => (
                  <button
                    key={s} type="button"
                    onClick={() => { if (s !== stage) setMoveTo(s as OppStage); }}
                    title={s === stage ? 'Current stage' : `Move to ${s} — asks for everything ${s} needs`}
                    style={{
                      padding: '6px 12px', borderRadius: 20,
                      border: `1px solid ${stage === s ? STAGE_TONE[s] : 'var(--line-strong)'}`,
                      background: stage === s ? STAGE_TONE[s] : 'white',
                      color: stage === s ? 'white' : 'var(--fg-3)',
                      fontSize: 12, fontWeight: 500, cursor: s === stage ? 'default' : 'pointer', fontFamily: 'inherit',
                    }}
                  >{s}</button>
                ))}
              </div>
              <input type="hidden" name="stage" value={stage} />
              <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 5 }}>
                Click another stage to move it there. The move asks for that stage&apos;s details — for Quoted, the quote, its line items and the document.
              </div>
            </div>

            {/* Every catalogue field for this stage, from one definition. This
                was a hand-written grid that had drifted from the create form —
                a product type offered in one was rejected by the other. */}
            <OppStageSections
              stage={stage as OppStage}
              values={values}
              onChange={setValue}
              optionsFor={optionsFor}
              usdRate={usdRate}
            />

            {/* Quotation PDF — manage it at any stage from Quoted onward. */}
            {(QUOTED_PLUS.includes(opp.stage) || opp.quotation_link) && (
              <QuotationPdfManager oppId={Number(opp.id)} initialLink={opp.quotation_link ?? null} canEdit />
            )}

            {/* Tour — an opportunity belongs to the client's tour and all its
                reps, not one owner, so there is no rep picker here. */}
            <div>
              <label style={LABEL_STYLE}>Tour · Reps / Manager</label>
              <div style={{ ...INPUT_STYLE, color: 'var(--fg-2)', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start', minHeight: 36, height: 'auto', padding: '8px 10px' }}>
                <span style={{ fontWeight: 600 }}>{opp.tour_name ?? '— no tour —'}</span>
                {opp.tour_people && <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{opp.tour_people}</span>}
              </div>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>
                Belongs to the client&apos;s tour — all its reps can work it.
              </div>
            </div>

            <QuotedItemsSection items={quoteItems} meta={quoteMeta} revisions={revisions} usdRate={usdRate}
              editOppId={Number(opp.id)} onItemsSaved={() => { setItemsVersion(v => v + 1); router.refresh(); }} />

            {/* History, below the fields and above the actions — it informs the
                edit without being part of it. */}
            <OppRemarksLog oppId={Number(opp.id)} />

            {error && (
              <div style={{ padding: '8px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderLeft: '3px solid var(--neg)', borderRadius: 5, color: '#9B1C1C', fontSize: 12 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', paddingTop: 4 }}>
              <DeleteOppButton oppId={Number(opp.id)} onDeleted={() => { draft.clear(); onClose(); router.refresh(); }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={guard.requestClose} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'white', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                  Cancel
                </button>
                <button type="submit" disabled={loading} style={{ padding: '8px 20px', borderRadius: 6, background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
                  {loading ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </form>
        )}
      </div>

      {/* The move form, the same one a drag on the board opens. It sits above
          the drawer (higher z-index) and, when the move lands, closes both —
          the record the drawer was showing is now somewhere else. */}
      {moveTo && (
        <OppStageMoveModal
          opp={{ ...(opp as unknown as Record<string, unknown>), id: opp.id, stage: opp.stage, client_name: opp.client_name, client_code: opp.client_code }}
          target={moveTo}
          usdRate={usdRate}
          onCancel={() => setMoveTo(null)}
          onDone={() => { draft.clear(); setMoveTo(null); onClose(); router.refresh(); }}
        />
      )}
    </>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label style={LABEL_STYLE}>{label}</label>
      <div style={{
        padding: '8px 10px', background: 'var(--bg-elev)',
        border: '1px solid var(--line)', borderRadius: 6,
        fontSize: 13, color: 'var(--fg)', whiteSpace: 'pre-wrap',
      }}>
        {value || '—'}
      </div>
    </div>
  );
}

// Compact 2-column label/value grid — dense alternative to a stack of boxed
// ReadOnlyRows, used for a Won opp's static deal facts.
function DetailGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '11px 16px',
      padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--bg-elev)',
    }}>
      {rows.map(([l, v]) => (
        <div key={l} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</div>
          <div style={{ fontSize: 13, color: 'var(--fg)', marginTop: 2, overflowWrap: 'anywhere' }}>{v || '—'}</div>
        </div>
      ))}
    </div>
  );
}

function QuotedItemsSection({ items, meta, revisions, usdRate, editOppId, onItemsSaved }: {
  items: QItem[]; meta: QMeta | null; revisions: OfferRevision[]; usdRate: number;
  /** When given, the Quoted Items card carries a pencil that opens the lines for editing in place. */
  editOppId?: number;
  onItemsSaved?: () => void;
}) {
  const inr = (v: number | null | undefined) => v != null ? '₹' + Math.round(v).toLocaleString('en-IN') : null;
  // Inline editing of the techno-commercial lines. Opens pre-filled from what
  // is on record; Save replaces the lines through saveQuotedItems and the
  // caller reloads them. Kept out of the main form so a change here does not
  // wait on, or get lost in, Save Changes above.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LineItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const toDraft = (xs: QItem[]): LineItem[] => xs.length ? xs.map(it => ({
    pump_model: it.pump_model ?? '', pump_qty: it.pump_qty != null ? String(it.pump_qty) : '', pump_speed: it.pump_speed ?? '',
    geared_motor_detail: it.geared_motor_detail ?? '', motor_price: it.motor_price != null ? String(it.motor_price) : '',
    gearbox_vbelt_price: it.gearbox_vbelt_price != null ? String(it.gearbox_vbelt_price) : '',
    offer_value_inr: it.offer_value_inr != null ? String(it.offer_value_inr) : '', detailed_specifications: it.detailed_specifications ?? '',
  })) : [emptyItem()];
  const openEditor = () => { setDraft(toDraft(items)); setErr(''); setEditing(true); };
  const save = async () => {
    if (editOppId == null) return;
    setSaving(true); setErr('');
    const res = await saveQuotedItems(editOppId, draft);
    setSaving(false);
    if (!res.ok) { setErr(res.error); return; }
    setEditing(false); onItemsSaved?.();
  };
  const facts: [string, string][] = [];
  if (meta) {
    const add = (l: string, v: unknown) => { const s = v == null ? '' : String(v).trim(); if (s && s !== '—') facts.push([l, s]); };
    add('Market', meta.market); add('Quarter', meta.qtr); add('RIL Rep', meta.ril_rep);
    add('Prepared By', meta.qtn_prepared_by); add('Client Status', meta.client_status_at_quote);
    add('Enquiry No', meta.enquiry_no); add('Enquiry Date', meta.enquiry_date);
    add('Location', meta.location);
    if (meta.probability_code) add('Probability', probabilityCodeDisplay(meta.probability_code));
    // The revised offer used to be two flat facts here. It's a history now —
    // rendered below as a list so every re-price is visible, not just the last.
  }
  if (!items.length && !facts.length && !revisions.length && editOppId == null) return null;
  return (
    <div style={{ marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
      <div style={{ ...LABEL_STYLE, marginBottom: 8 }}>Quotation Details</div>
      {facts.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 12px', marginBottom: items.length ? 12 : 0 }}>
          {facts.map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: 9.5, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{l}</div>
              <div style={{ fontSize: 12.5, color: 'var(--fg)', marginTop: 1 }}>{v}</div>
            </div>
          ))}
        </div>
      )}
      {revisions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', margin: '4px 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Revised Offers ({revisions.length})</div>
          <OfferRevisionsList revisions={revisions} baseOfferInr={meta?.offer_value_inr ?? null} usdRate={usdRate} compact />
        </div>
      )}
      {meta?.quotation_link && <QuotationLinkView value={meta.quotation_link} label="Open quotation" />}
      {(items.length > 0 || editOppId != null) && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 6px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quoted Items ({items.length})</span>
            {editOppId != null && !editing && (
              <button type="button" onClick={openEditor} title={items.length ? 'Edit the techno-commercial details of these lines' : 'Add the quoted lines'}
                style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-paper)', color: 'var(--fg-2)', cursor: 'pointer' }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10z" /><path d="M10.5 3.5l2 2" /></svg>
                {items.length ? 'Edit items' : 'Add items'}
              </button>
            )}
          </div>
          {editing ? (
            <div style={{ border: '1px solid var(--line-strong)', borderRadius: 8, padding: '10px 12px', background: 'var(--bg-paper)' }}>
              <QuoteLineItems items={draft} onChange={setDraft} />
              {err && <div style={{ color: 'var(--neg)', fontSize: 12, marginTop: 8 }}>{err}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                <button type="button" onClick={() => setEditing(false)} disabled={saving}
                  style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-paper)', color: 'var(--fg)', cursor: 'pointer' }}>Cancel</button>
                <button type="button" onClick={save} disabled={saving}
                  style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', border: 'none', borderRadius: 6, background: 'var(--accent-fill)', color: 'var(--on-accent)', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Saving…' : 'Save items'}
                </button>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 6 }}>Saves the lines on their own — the rest of the form is untouched. A blank Total Offer takes their sum.</div>
            </div>
          ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(it => (
              <div key={it.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', background: 'var(--bg-elev)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', overflowWrap: 'anywhere' }}>{it.pump_model || '—'}</span>
                  {inr(it.offer_value_inr) && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--title)', flexShrink: 0 }}>{inr(it.offer_value_inr)}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {it.pump_qty != null && <span>Qty {it.pump_qty}</span>}
                  {it.pump_speed && <span>{it.pump_speed}</span>}
                  {inr(it.motor_price) && <span>Motor {inr(it.motor_price)}</span>}
                  {inr(it.gearbox_vbelt_price) && <span>GB/V-belt {inr(it.gearbox_vbelt_price)}</span>}
                </div>
                {it.geared_motor_detail && <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{it.geared_motor_detail}</div>}
                {it.detailed_specifications && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{it.detailed_specifications}</div>}
              </div>
            ))}
            {!items.length && <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>No quoted lines on record.</div>}
          </div>
          )}
        </>
      )}
    </div>
  );
}

function DeleteOppButton({ oppId, onDeleted }: { oppId: number; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  if (confirming) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--neg)' }}>Delete permanently?</span>
        <button
          type="button" disabled={loading}
          onClick={async () => {
            setLoading(true); setError('');
            // Without this the promise could reject (e.g. a Won/Lost deal is now
            // admin-locked) and leave the button stuck on '…' with no message.
            try {
              const res = await deleteOpportunity(oppId);
              if (!res.ok) { setError(res.error); setLoading(false); return; }
              onDeleted();
            }
            catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); setLoading(false); }
          }}
          style={{ padding: '5px 10px', borderRadius: 5, background: 'var(--neg-fill)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}
        >
          {loading ? '…' : 'Yes, Delete'}
        </button>
        <button type="button" onClick={() => { setConfirming(false); setError(''); }} style={{ padding: '5px 10px', borderRadius: 5, border: '1px solid var(--line-strong)', background: 'white', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
          Cancel
        </button>
        {error && <span style={{ fontSize: 11.5, color: 'var(--neg)', flexBasis: '100%' }}>{error}</span>}
      </div>
    );
  }

  return (
    <button type="button" onClick={() => setConfirming(true)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #F87171', background: 'white', color: '#E02424', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
      Delete
    </button>
  );
}

const LABEL_STYLE: CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  display: 'block', marginBottom: 5,
};

const INPUT_STYLE: CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)',
  borderRadius: 6, fontSize: 13, background: 'var(--bg-elev)', color: 'var(--fg)',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
