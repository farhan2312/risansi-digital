'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import AssignVisitDrawer, { type DrawerRep } from './AssignVisitDrawer';
import { NewOpportunityModal } from './NewOpportunityModal';
import { ClientFormDrawer } from './ClientFormDrawer';
import { Toast } from './Toast';
import { PLAN_VISIT_LABEL } from '@/lib/risansi-utils';

// ── Event names ────────────────────────────────────────────────

export const OPEN_OPP_DRAWER     = 'risansi:open-opp-drawer';
export const OPEN_EDIT_DRAWER    = 'risansi:open-edit-drawer';

// ── External trigger button (pencil) for edit drawer ───────────

export function EditDrawerTrigger({ label = '✎', style }: { label?: string; style?: CSSProperties }) {
  return (
    <button
      type="button"
      title="Edit client details"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EDIT_DRAWER))}
      style={style ?? PENCIL_BTN}
    >
      {label}
    </button>
  );
}

// ── Props ──────────────────────────────────────────────────────

interface Props {
  clientId:    string;
  /** ₹ per $1 from the settings page — drives the USD sub-text on money fields. */
  usdRate?:    number;
  clientName:  string;
  clientCode:  string;
  industry:    string;
  repId:       string | null;
  /** Whole tour roster, for display. */
  repName:     string;
  /** The single resolved owner for new work, null when the tour can't decide. */
  ownerName?:  string | null;
  reps:        DrawerRep[];
  clientData:  any;
  contacts?:   any[];
  canEdit?:    boolean;
  currentUserName?:  string;
  currentUserRepId?: string | number | null;
  currentUserRole?:  string;
}

// ── Component ──────────────────────────────────────────────────

export function ClientActionButtons({
  clientId, clientName, clientCode, industry, repId, repName, ownerName, reps, clientData, contacts, canEdit = false,
  currentUserName, currentUserRepId, currentUserRole, usdRate,
}: Props) {
  const [isVisitOpen, setIsVisitOpen] = useState(false);
  const [isOppOpen,  setIsOppOpen]  = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Listen for the open-opp-drawer event (dispatched by PipelineOppBtn)
  useEffect(() => {
    function handleOppOpen()  { setIsOppOpen(true); }
    function handleEditOpen() { setIsEditOpen(true); }
    window.addEventListener(OPEN_OPP_DRAWER,  handleOppOpen);
    window.addEventListener(OPEN_EDIT_DRAWER, handleEditOpen);
    return () => {
      window.removeEventListener(OPEN_OPP_DRAWER,  handleOppOpen);
      window.removeEventListener(OPEN_EDIT_DRAWER, handleEditOpen);
    };
  }, []);

  function handleVisitSuccess() {
    setToast({ message: 'Visit scheduled successfully', type: 'success' });
  }

  return (
    <>
      <div className="r-action-row" style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button type="button" onClick={() => setIsVisitOpen(true)} style={BTN}>
          {PLAN_VISIT_LABEL}
        </button>
        <button type="button" onClick={() => setIsOppOpen(true)} style={BTN}>
          New Opportunity
        </button>
        {canEdit && (
          <button type="button" onClick={() => setIsEditOpen(true)} style={{ ...BTN, background: 'var(--accent-fill)', color: 'var(--on-accent)', border: '1px solid var(--accent-fill)' }}>
            Edit Record
          </button>
        )}
      </div>

      {/* Mobile-only floating action button → plan a visit for this client
          (reuses the same visit drawer + access rules as the desktop button). */}
      <button type="button" className="r-visit-fab" onClick={() => setIsVisitOpen(true)}
        aria-label={PLAN_VISIT_LABEL} title={PLAN_VISIT_LABEL}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {/* Visit drawer — opened directly via props (client pre-filled & locked),
          rep is locked to themselves when role === 'rep' */}
      <AssignVisitDrawer
        reps={reps}
        hideButton
        controlledOpen={isVisitOpen}
        onClose={() => setIsVisitOpen(false)}
        prefilledClient={{ id: String(clientId), code: clientCode, legal_name: clientName }}
        prefilledRepId={repId}
        lockClient
        onSuccess={handleVisitSuccess}
        role={currentUserRole}
        repId={currentUserRepId}
        currentUserName={currentUserName}
      />

      {/* Opportunity modal — shared with the Opportunities page, client locked here */}
      <NewOpportunityModal
        open={isOppOpen}
        onClose={() => setIsOppOpen(false)}
        usdRate={usdRate}
        lockClient
        clientId={clientId}
        clientName={clientName}
        clientCode={clientCode}
        clientIndustry={industry}
        clientOwnerName={ownerName ?? null}
      />

      {/* Edit client drawer — unified ClientFormDrawer in edit mode */}
      {isEditOpen && (
        <ClientFormDrawer
          mode="edit"
          client={clientData}
          existingContacts={contacts ?? []}
          onClose={() => setIsEditOpen(false)}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </>
  );
}

// ── Tiny button for the pipeline panel "New Opportunity" ─────

export function PipelineOppBtn() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_OPP_DRAWER))}
      style={GHOST_BTN}
    >
      New Opportunity
    </button>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 11px', fontSize: 12, fontFamily: 'inherit',
  fontWeight: 500, background: 'var(--bg-paper)',
  border: '1px solid #CBD5E1', color: 'var(--fg)',
  borderRadius: 5, cursor: 'pointer',
};

const GHOST_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '3px 8px', fontSize: 11, fontFamily: 'inherit',
  fontWeight: 500, background: 'transparent',
  border: '1px solid #CBD5E1', color: 'var(--brand-blue)',
  borderRadius: 5, cursor: 'pointer',
};

const PENCIL_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22,
  background: 'transparent', border: '1px solid var(--line)',
  color: 'var(--fg-3)', borderRadius: 4,
  cursor: 'pointer', fontSize: 12,
};
