'use client';

import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { saveVisitField, checkInVisit, addEquipment, updateEquipment, deleteEquipment, saveExpansionOpportunity, saveClientProfileFromVisit } from '@/app/actions/risansi-visits';
import { CLIENT_TYPES, isEpcOem } from '@/lib/risansi-client-types';
import { ClientPumpEditor } from './ClientPumpEditor';
import { LogComplaintButton } from './LogComplaintButton';
import { updateTaskStatus, deleteTask } from '@/app/actions/risansi-tasks';
import { PRODUCT_TYPES } from '@/lib/risansi-opportunity-fields';
import { ResolveActionDialog, type ResolvingAction } from './ResolveActionDialog';
import { AddActionForm } from './AddActionForm';
import { PROBABILITY_CODES, probabilityCodeLabel } from '@/lib/risansi-probability-codes';
import { MonthYearSelect } from './MonthYearSelect';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormErrorBoundary } from './FormErrorBoundary';
import { AddContactButton } from './AddContactButton';
import { EditContactButton } from './EditContactButton';
import { SubmitVisitButton } from './SubmitVisitButton';
import { VisitPhotos } from './VisitPhotos';
import { VISIT_EDIT_WINDOW_DAYS } from '@/lib/risansi-visit-edit-window';

// Major competitor makes for the Competitor Equipment dropdown. Mirrors the
// per-maker columns tracked in competitor_installed_base. Pick "Other" to type
// a make that isn't listed.
const COMPETITOR_MAKES = [
  'Roto', 'Rotomac', 'Gita', 'PSP', 'Syno', 'Ropman', 'Myto', 'Vikas',
  'Newpumps', 'Indopump', 'Tushaco', 'Yaswant', 'Shivam', 'Saksham', 'Sintex', 'Alpha',
  'Gajanan', 'Chandra Helicon', 'Netzsch', 'Akanshi', 'Pragati', 'Ropar',
  'Rotor Flow', 'Naishit', 'Delta', 'Varun', 'NPI', 'Hydroprocav', 'SRE',
  'Span Engg', 'Pandey', 'Mahalaxmi', 'Ravalgoan',
];

// Duty and build options for the equipment sub-form. Each select keeps any
// legacy value it is handed, so an option retired from these lists never
// silently blanks an existing row on the next save.
const DRIVE_SYSTEMS = [
  'Direct Coupled', 'Geared Motor', 'V-Belt', 'Gearbox', 'VFD', 'Other',
];
const MOC_OPTIONS = [
  'CI', 'CS', 'SS304', 'SS316', 'SS316L', 'Duplex', 'Hastelloy', 'Other',
];
const COMPETITOR_ACTIVITY = [
  'New Installation', 'Replacement', 'Spares Supply', 'Rate Contract',
  'Trial / Demo', 'Quoted, Not Ordered',
];

// ── Types ──────────────────────────────────────────────────────

interface VisitData {
  id: string; client_id: string; rep_id: string | null;
  visit_date: string;
  check_in_time: string | null; check_in_lat: number | null;
  check_in_lng: number | null; check_in_accuracy_m: number | null;
  gps_within_radius: boolean | null; manual_checkin: boolean | null;
  purpose: string | null; outcome: string | null; summary: string | null;
  industry_format: string | null; is_unplanned: boolean | null;
  unplanned_reason: string | null;
  competitor_activity_observed: boolean | null;
  sample_or_gift_given: boolean | null; sample_gift_detail: string | null;
  sample_gift_value: number | null; follow_up_required: boolean | null;
  follow_up_text: string | null; follow_up_due_date: string | null;
  next_visit_recommendation: string | null;
  performance_feedback: string | null; pcp_competitor: string | null;
  mgmt_intervention: string | null; action_points: string | null;
  open_remarks: string | null; status: string; submitted_at: string | null;
  legal_name: string; code: string; industry: string | null;
  is_sugar: boolean; city: string | null;
  // Client profile fields edited on the Client Type page (persist to the client)
  client_type: string | null; focus_industries: string[] | null;
  tcd: number | null;
  avg_annual_pump_req: number | null; ongoing_tenders: number | null;
  upcoming_tenders: boolean | null; upcoming_tenders_details: string | null;
  pcp_suppliers: string | null;
}

interface Contact {
  id: number; name: string; designation: string | null;
  phone: string | null; is_primary: boolean;
  email: string | null; whatsapp: string | null; notes: string | null;
}

interface TaskItem {
  id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string | null;
  status: string;
  assigned_to_rep: number | null;
  assigned_to_external: string | null;
  assigned_rep_name: string | null;
  created_by: string | null;
  resolution_note?: string | null;
}

interface TaskRep { id: number; name: string; zone: string | null }

interface ExpansionOpp {
  id: number;
  product: string | null;
  product_type: string | null;
  stage: string | null;
  value_cr: string | number | null;
  probability: number | null;
  probability_code: string | null;
  eta_text: string | null;
  quote_ref: string | null;
  notes: string | null;
  tsm_user_id: number | null;
  tsm_external: string | null;
  tsm_external_email: string | null;
}

// ── Props ──────────────────────────────────────────────────────

interface Props {
  visit:          VisitData;
  contacts:       Contact[];
  equipment:      Record<string, unknown>[];
  sugarReport:    Record<string, unknown> | null;
  nonsugarReport: Record<string, unknown> | null;
  opportunities:  Record<string, unknown>[];
  tasks:          TaskItem[];
  reps:           TaskRep[];
  expansionOpp:   ExpansionOpp | null;
  isSubmitted:    boolean;          // the report has been closed (submitted_at set)
  canEditVisit:   boolean;          // this viewer is allowed to edit at all (role)
  canReopen:      boolean;          // …and it's still inside the 30-day window
  closedDate:     string | null;    // formatted first-closed date
  daysLeft:       number;           // whole days left in the re-open window
  isSugar:        boolean;
  industries:     string[];         // taxonomy for the EPC/OEM focus-industries picker
}

// ── Auto-save hook ─────────────────────────────────────────────

function useAutoSave(visitId: string) {
  const draftKey = `risansi_visit_draft_${visitId}`;
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  // True when a previous session left unsynced field changes in localStorage
  // (e.g. the rep lost signal in the field before the 5s auto-save fired).
  const [hasDraft, setHasDraft] = useState(false);
  // Why it failed, when the server said. "Save failed" on its own leaves a rep
  // retyping into a report that is closed for editing and will refuse again.
  const [saveError, setSaveError] = useState('');
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending    = useRef<Record<string, unknown>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      const obj = raw ? JSON.parse(raw) : null;
      if (obj && typeof obj === 'object' && Object.keys(obj).length > 0) setHasDraft(true);
    } catch { /* ignore */ }
  }, [draftKey]);

  const queueSave = useCallback((field: string, value: unknown) => {
    pending.current[field] = value;
    // Persist immediately so a dropped connection / closed tab can't lose entry.
    try { localStorage.setItem(draftKey, JSON.stringify(pending.current)); } catch { /* ignore */ }
    setSaveState('pending');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const res = await saveVisitField(visitId, pending.current);
        if (!res.ok) { setSaveError(res.error); setSaveState('error'); return; }
        setSaveError('');
        pending.current = {};
        try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
        setHasDraft(false);
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 3000);
      } catch {
        setSaveState('error');   // draft stays in localStorage for recovery
      }
    }, 5000);
  }, [visitId, draftKey]);

  // Re-send a recovered draft (the "Sync now" banner action).
  const syncDraft = useCallback(async () => {
    try {
      const raw = localStorage.getItem(draftKey);
      const obj = raw ? JSON.parse(raw) : null;
      if (!obj || Object.keys(obj).length === 0) { setHasDraft(false); return; }
      setSaveState('saving');
      const res = await saveVisitField(visitId, obj);
      if (!res.ok) { setSaveError(res.error); setSaveState('error'); return; }
      setSaveError('');
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      setHasDraft(false);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 3000);
    } catch {
      setSaveState('error');
    }
  }, [visitId, draftKey]);

  return { saveState, saveError, queueSave, hasDraft, syncDraft };
}

// ── Main Component ─────────────────────────────────────────────

export function VisitReportForm({
  visit, contacts, equipment, sugarReport, nonsugarReport,
  opportunities, tasks, reps, expansionOpp,
  isSubmitted, canEditVisit, canReopen, closedDate, daysLeft, isSugar: initialIsSugar,
  industries,
}: Props) {
  const { saveState, saveError, queueSave, hasDraft, syncDraft } = useAutoSave(visit.id);
  // One place for a refusal from the buttons on this form — equipment, check-in,
  // the client profile. Shown beside the save indicator rather than as an alert.
  const [actionError, setActionError] = useState('');
  const router = useRouter();

  // Closing an action point asks what was done, the same as everywhere else.
  const [resolvingTask, setResolvingTask] = useState<ResolvingAction | null>(null);
  const handleCompleteTask = async (taskId: number, status: 'open' | 'completed', title = '', existingNote: string | null = null) => {
    if (status === 'completed') { setResolvingTask({ id: taskId, title, existingNote }); return; }
    const res = await updateTaskStatus(taskId, 'open');
    if (!res.ok) { setActionError(res.error); return; }
    router.refresh();
  };
  const handleDeleteTask = async (taskId: number) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this action point? This cannot be undone.')) return;
    const res = await deleteTask(taskId);
    if (!res.ok) { setActionError(res.error); return; }
    setActionError('');
    router.refresh();
  };

  // Local state for conditional fields
  const [isSugar, setIsSugar]         = useState(initialIsSugar);
  const [purpose, setPurpose]         = useState(visit.purpose ?? '');
  const [outcome, setOutcome]         = useState(visit.outcome ?? '');
  const [isUnplanned, setIsUnplanned] = useState(!!visit.is_unplanned);
  const [sampleGiven, setSampleGiven] = useState(!!visit.sample_or_gift_given);
  const [followUp, setFollowUp]       = useState(!!visit.follow_up_required);
  const [compActivity, setCompActivity] = useState(!!visit.competitor_activity_observed);

  // ── Client Type page (persists to the CLIENT, not the visit) ──
  const [clientType, setClientType]           = useState(visit.client_type ?? '');
  const [tcd, setTcd]                         = useState(visit.tcd?.toString() ?? '');
  const [focusInd, setFocusInd]               = useState<string[]>(visit.focus_industries ?? []);
  const [avgPumpReq, setAvgPumpReq]           = useState(visit.avg_annual_pump_req?.toString() ?? '');
  const [ongoingTenders, setOngoingTenders]   = useState(visit.ongoing_tenders?.toString() ?? '');
  const [upcomingTenders, setUpcomingTenders] = useState<boolean>(!!visit.upcoming_tenders);
  const [upcomingDetails, setUpcomingDetails] = useState(visit.upcoming_tenders_details ?? '');
  const [pcpSuppliers, setPcpSuppliers]       = useState(visit.pcp_suppliers ?? '');
  const [ctSaved, setCtSaved]                 = useState(false);
  const [ctError, setCtError]                 = useState(false);
  const showEpcOem = isEpcOem(clientType);
  // Chips to render: the taxonomy PLUS any already-saved value not in it, so a
  // stored focus industry never becomes invisible/unselectable.
  const focusChips = Array.from(new Set([...industries, ...focusInd]));

  // Snapshot of what's persisted, so an onChange/onBlur that didn't actually
  // change a value doesn't fire a redundant UPDATE (and updated_at bump).
  const savedRef = useRef<Record<string, string>>({
    client_type:              JSON.stringify(visit.client_type ?? null),
    tcd:                      JSON.stringify(visit.tcd ?? null),
    focus_industries:         JSON.stringify(visit.focus_industries ?? []),
    avg_annual_pump_req:      JSON.stringify(visit.avg_annual_pump_req ?? null),
    ongoing_tenders:          JSON.stringify(visit.ongoing_tenders ?? null),
    upcoming_tenders:         JSON.stringify(visit.upcoming_tenders ?? false),
    upcoming_tenders_details: JSON.stringify(visit.upcoming_tenders_details ?? null),
    pcp_suppliers:            JSON.stringify(visit.pcp_suppliers ?? null),
  });

  // Persist a client-profile patch. Drops keys whose value is unchanged, and
  // surfaces success (✓) or failure (⚠) so a lost save never looks like it saved.
  const saveClientProfile = async (patch: Record<string, unknown>) => {
    const changed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      const ser = JSON.stringify(v ?? null);
      if (savedRef.current[k] !== ser) { changed[k] = v; savedRef.current[k] = ser; }
    }
    if (Object.keys(changed).length === 0) return;
    try {
      const res = await saveClientProfileFromVisit(visit.id, changed);
      if (!res.ok) { setActionError(res.error); return; }
      setActionError('');
      setCtError(false); setCtSaved(true);
      window.setTimeout(() => setCtSaved(false), 1500);
    } catch (e) {
      for (const k of Object.keys(changed)) delete savedRef.current[k];   // let a retry re-send
      setCtSaved(false); setCtError(true);
      console.error('saveClientProfileFromVisit failed', e);
    }
  };
  // Blank → null; negatives / non-numbers → null (an integer column never gets '').
  const numOrNull = (s: string) => { const n = parseInt(s, 10); return Number.isFinite(n) && n >= 0 ? n : null; };
  // Mirror the server's EPC-field retirement in the form + snapshot when the
  // type moves away from EPC/OEM, so the same session doesn't show stale values.
  const clearEpcState = () => {
    setFocusInd([]); setAvgPumpReq(''); setOngoingTenders('');
    setUpcomingTenders(false); setUpcomingDetails(''); setPcpSuppliers('');
    savedRef.current.focus_industries         = JSON.stringify([]);
    savedRef.current.avg_annual_pump_req      = JSON.stringify(null);
    savedRef.current.ongoing_tenders          = JSON.stringify(null);
    savedRef.current.upcoming_tenders         = JSON.stringify(false);
    savedRef.current.upcoming_tenders_details = JSON.stringify(null);
    savedRef.current.pcp_suppliers            = JSON.stringify(null);
  };

  // Sugar-specific state
  const [hasComplaints, setHasComplaints] = useState(!!(sugarReport?.has_complaints));

  // Equipment
  const [eqTab, setEqTab]   = useState<'ril' | 'competitor'>('ril');
  // Live count of the client's installed pumps (client_pumps), reported by the
  // RIL editor, so the RIL tab badge matches what that tab actually shows.
  const [rilPumpCount, setRilPumpCount] = useState<number | null>(null);
  const [showEqForm, setShowEqForm] = useState(false);
  // id of the equipment row being edited (null = adding a new row)
  const [editingEqId, setEditingEqId] = useState<number | null>(null);
  // true when the competitor make isn't in COMPETITOR_MAKES (free-text entry)
  const [supplierOther, setSupplierOther] = useState(false);
  // qty is kept as the raw typed string (like tcd/avgPumpReq below) so a cleared
  // field and an explicit "0" don't collapse into the same state — parsed at save.
  const [newEq, setNewEq] = useState({
    pump_type: 'PCP', supplier: '', model: '', qty: '1',
    application: '', condition: 'Good', condition_remark: '', is_ril: true,
    reason_for_competitor: '', competitor_activity_type: '',
    performance_feedback: '',
    // Duty and build. Held as strings like every other input here; the numeric
    // ones are parsed on save, since capacity/head/kW are numeric columns and an
    // empty string would be rejected outright.
    capacity_m3h: '', head_m: '', kw: '', drive_system: '', moc: '',
  });

  // A submitted report shows as Closed and is read-only until the viewer
  // re-opens it (allowed only when canReopen). A draft is editable straight away
  // by anyone authorised. `reopened` is intentionally session-only: reload and
  // it's Closed again, so an edit is always a deliberate act.
  const [reopened, setReopened] = useState(false);
  const disabled = isSubmitted ? !reopened : !canEditVisit;

  // ── Wizard step state ───────────────────────────────────────
  // Each step shows a slice of the (always-mounted) sections via display
  // toggling, so auto-save and field state are never lost on navigation.
  // Keyed steps — small, focused screens so each fits without much scrolling.
  // Sugar visits get two industry sub-steps; non-sugar gets one. Filtered list
  // drives the stepper; `curKey` drives which section block is shown.
  const [stepIdx, setStepIdx] = useState(0);
  const allSteps = [
    { key: 'checkin',   label: 'Check-in',  title: 'Check in',              desc: 'Confirm your GPS check-in for this visit.', show: true },
    { key: 'details',   label: 'Details',   title: 'Visit details',         desc: 'Purpose and outcome of the visit.',         show: true },
    { key: 'contacts',  label: 'Contacts',  title: 'Contacts',              desc: 'People you met / manage at this client.',   show: true },
    { key: 'sugar1',    label: 'Pumps',     title: 'RIL pump install base', desc: 'Screw & rota pumps installed at the plant.', show: isSugar },
    { key: 'sugar2',    label: 'Commercial',title: 'Commercial discussion', desc: 'Complaints, payments and purchasing.',       show: isSugar },
    { key: 'nonsugar',  label: 'Industry',  title: 'Industry report',       desc: 'Products dealt and equipment observed.',     show: !isSugar },
    { key: 'equipment', label: 'Equipment', title: 'Equipment & competition', desc: 'RIL and competitor pumps seen.',           show: true },
    { key: 'opps',      label: 'Opportunities', title: 'Opportunities',     desc: 'Expansion plans and new business.',          show: true },
    { key: 'clienttype',label: 'Client Type', title: 'Client type',         desc: 'Confirm the client type — EPC/OEM adds a few questions.', show: true },
    { key: 'summary',   label: 'Summary',   title: 'Visit summary',         desc: 'Performance, feedback and remarks.',         show: true },
    { key: 'photos',    label: 'Photos',    title: 'Site photos',           desc: 'Capture site / equipment photos — camera or gallery.', show: true },
    { key: 'actions',   label: 'Actions',   title: 'Action register',       desc: 'Add action points, then submit the report.', show: true },
  ];
  const steps = allSteps.filter(s => s.show);
  const LAST = steps.length - 1;
  const step = Math.min(stepIdx, LAST);
  const curKey = steps[step]?.key ?? 'checkin';
  const goStep = (n: number) => {
    setStepIdx(Math.max(0, Math.min(LAST, n)));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Derived preview data
  const rilEquipment  = equipment.filter(e => e.is_ril);
  const compEquipment = equipment.filter(e => !e.is_ril);
  const dispOpps      = equipment.filter(e => e.is_opportunity);
  const willPreview   = followUp || dispOpps.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Closed / re-open banner (submitted reports only) ───────── */}
      {isSubmitted && !reopened && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          padding: '11px 16px', borderRadius: 12,
          background: 'var(--bg-elev)', border: '1px solid var(--line-strong)',
        }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-2)', minWidth: 0 }}>
            <b style={{ color: 'var(--fg)' }}>Closed{closedDate ? ` on ${closedDate}` : ''}.</b>{' '}
            {canReopen
              ? `Corrections are still possible — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left in the ${VISIT_EDIT_WINDOW_DAYS}-day window. Re-open to edit; changes are logged to the client's activity.`
              : canEditVisit
                ? `The ${VISIT_EDIT_WINDOW_DAYS}-day correction window has passed — this report is now locked.`
                : 'View only.'}
          </div>
          {canReopen && (
            <button type="button" onClick={() => setReopened(true)} style={{
              flexShrink: 0, padding: '7px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
              background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Re-open to edit
            </button>
          )}
        </div>
      )}

      {/* Re-opened: editing an otherwise-closed report. */}
      {isSubmitted && reopened && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          padding: '11px 16px', borderRadius: 12,
          background: 'var(--accent-soft)', border: '1px solid var(--accent-line)',
        }}>
          <div style={{ fontSize: 12.5, color: 'var(--title)', minWidth: 0 }}>
            <b>Re-opened for editing.</b> Changes save automatically and are logged to the client&apos;s activity.
            This report stays Closed{closedDate ? ` (${closedDate})` : ''}.
          </div>
          <button type="button" onClick={() => setReopened(false)} style={{
            flexShrink: 0, padding: '7px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
            background: 'var(--bg-paper)', color: 'var(--title)', border: '1px solid var(--title)', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Done
          </button>
        </div>
      )}

      {/* ── Progress header: slim stepper + current step title ─────── */}
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 16px 14px' }}>
        {/* Dots-only progress track (scales to any number of steps) */}
        <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 8, right: 8, height: 3, background: 'var(--line)', borderRadius: 2 }} />
          <div style={{ position: 'absolute', left: 8, width: `calc((100% - 16px) * ${LAST > 0 ? step / LAST : 0})`, height: 3, background: 'var(--accent-fill)', borderRadius: 2, transition: 'width 280ms ease' }} />
          {steps.map((s, i) => {
            const active = i === step, done = i < step;
            return (
              <button key={s.key} type="button" className="r-step-dot" onClick={() => goStep(i)} aria-current={active} title={s.title}
                style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0', position: 'relative', zIndex: 1 }}>
                <span style={{
                  width: active ? 26 : 16, height: active ? 26 : 16, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  fontSize: 11, fontWeight: 700, transition: 'all 200ms',
                  background: active || done ? 'var(--accent-fill)' : 'var(--bg-paper)',
                  color: 'var(--on-accent)',
                  border: active || done ? '2px solid var(--accent-fill)' : '2px solid var(--line-strong)',
                  boxShadow: active ? '0 0 0 4px var(--accent-soft)' : 'none',
                }}>{active ? i + 1 : done ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>

        {/* Current step title + description + save status */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--fg-3)', textTransform: 'uppercase' }}>
              Step {step + 1} of {steps.length}
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--fg)', marginTop: 2, letterSpacing: '-0.01em' }}>{steps[step]?.title}</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>{steps[step]?.desc}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap',
            color: saveState === 'saved' ? 'var(--pos)' : saveState === 'error' ? 'var(--neg)' : 'var(--fg-3)', transition: 'color 300ms' }}>
            {saveState === 'saving' && '⟳ Saving…'}
            {saveState === 'saved'  && '✓ Saved'}
            {saveState === 'error'  && (saveError || '⚠ Save failed')}
          </span>
        </div>
        {actionError && (
          <div style={{ margin: '0 0 10px', padding: '9px 12px', borderRadius: 6, fontSize: 12.5, lineHeight: 1.5,
                        background: 'var(--neg-soft)', border: '1px solid var(--neg)', color: 'var(--neg-strong)' }}>
            {actionError}
          </div>
        )}
      </div>

      {/* Draft recovery — unsynced changes survived a closed tab / dropped signal. */}
      {hasDraft && !disabled && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: 'var(--warn-soft)', border: '1px solid #FCD34D', borderRadius: 12,
          padding: '10px 14px', fontSize: 12, color: 'var(--warn)',
        }}>
          <span style={{ flex: 1, minWidth: 160 }}>
            Unsynced changes from an earlier session were found on this device.
          </span>
          <button
            type="button"
            onClick={async () => { await syncDraft(); router.refresh(); }}
            style={{
              padding: '8px 14px', minHeight: 40, borderRadius: 8, border: 'none',
              background: '#92400E', color: '#fff', fontWeight: 600, fontSize: 12,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Sync now
          </button>
        </div>
      )}

      {/* ══ STEP: Check-in ══ */}
      <div style={{ display: curKey === 'checkin' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

      {/* ── SECTION 1: Check In ────────────────────────────── */}
      <FormSection title="Check In" icon="📍">
        {visit.check_in_time ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--pos-soft)', borderRadius: 8, fontSize: 13 }}>
            <span>✓</span>
            <div>
              <div style={{ fontWeight: 600 }}>
                Checked in at {new Date(visit.check_in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </div>
              {visit.check_in_lat != null && visit.check_in_lng != null && (
                <div style={{ fontSize: 11, color: 'var(--pos)' }}>
                  {/* numeric columns arrive as strings from pg — coerce before toFixed */}
                  GPS: {Number(visit.check_in_lat).toFixed(4)}, {Number(visit.check_in_lng).toFixed(4)}
                  {visit.check_in_accuracy_m != null && ` · ±${Math.round(Number(visit.check_in_accuracy_m))}m`}
                  {' · '}
                  <a
                    href={`https://www.google.com/maps?q=${visit.check_in_lat},${visit.check_in_lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--pos)', textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    📍 View location
                  </a>
                </div>
              )}
              {visit.manual_checkin && (
                <div style={{ fontSize: 11, color: 'var(--warn)' }}>Manual check-in recorded</div>
              )}
            </div>
          </div>
        ) : !disabled ? (
          <FormErrorBoundary>
            <CheckInButton visitId={visit.id} onDone={() => router.refresh()} />
          </FormErrorBoundary>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--fg-3)', padding: '8px 0' }}>No check-in recorded</div>
        )}
      </FormSection>

      </div>{/* end STEP 0 */}

      {/* ══ STEP: Visit Details ══ */}
      <div style={{ display: curKey === 'details' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

      {/* ── SECTION 2: Visit Details ───────────────────────── */}
      <FormSection title="Visit Details" icon="📋">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={LBL}>Purpose</label>
            <select
              value={purpose} disabled={disabled}
              onChange={e => { setPurpose(e.target.value); queueSave('purpose', e.target.value); }}
              style={INP}
            >
              <option value="">— Select —</option>
              {['Routine','Quote Follow-up','Complaint Resolution','New Opportunity','Equipment Assessment','Management Relationship Visit'].map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={LBL}>Outcome</label>
            <select
              value={outcome} disabled={disabled}
              onChange={e => { setOutcome(e.target.value); queueSave('outcome', e.target.value); }}
              style={INP}
            >
              <option value="">— Select —</option>
              {['Very Positive','Positive','Neutral','Needs Attention','Escalation Required'].map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Industry format toggle */}
        <div style={{ marginBottom: 12 }}>
          <label style={LBL}>Industry Format</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['sugar', 'Sugar'], ['non-sugar', 'Non-Sugar']].map(([val, label]) => (
              <button
                key={val}
                disabled={disabled}
                onClick={() => {
                  setIsSugar(val === 'sugar');
                  queueSave('industry_format', val);
                }}
                style={{
                  padding: '6px 16px', borderRadius: 6, fontSize: 13,
                  fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer',
                  border: (isSugar ? 'sugar' : 'non-sugar') === val ? '2px solid var(--toggle-sel-border)' : '1px solid var(--line-strong)',
                  background: (isSugar ? 'sugar' : 'non-sugar') === val ? 'var(--toggle-sel-bg)' : 'var(--bg-paper)',
                  color: (isSugar ? 'sugar' : 'non-sugar') === val ? 'var(--toggle-sel-fg)' : 'var(--fg-3)',
                  fontWeight: (isSugar ? 'sugar' : 'non-sugar') === val ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Unplanned */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer', marginBottom: 8 }}>
          <input
            type="checkbox" checked={isUnplanned} disabled={disabled}
            onChange={e => { setIsUnplanned(e.target.checked); queueSave('is_unplanned', e.target.checked); }}
            style={{ width: 14, height: 14 }}
          />
          <span style={{ fontSize: 13 }}>Unplanned visit</span>
        </label>
        {isUnplanned && (
          <div style={{ marginBottom: 8 }}>
            <label style={LBL}>Reason for unplanned visit</label>
            <input
              type="text"
              defaultValue={visit.unplanned_reason ?? ''}
              disabled={disabled}
              onChange={e => queueSave('unplanned_reason', e.target.value)}
              style={INP}
              placeholder="e.g. Client called urgently"
            />
          </div>
        )}

        {/* Contacts */}
        {contacts.length > 0 && (
          <div>
            <label style={LBL}>Contacts Met</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {contacts.map(c => (
                <div key={c.id} style={{
                  padding: '5px 10px', borderRadius: 20, fontSize: 12,
                  border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
                  color: 'var(--fg-2)',
                }}>
                  {c.name}{c.designation ? ` · ${c.designation}` : ''}
                  {c.is_primary && <span style={{ marginLeft: 4, color: 'var(--title)', fontSize: 10, fontWeight: 600 }}>PRIMARY</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </FormSection>

      </div>{/* end details */}

      {/* ══ STEP: Contacts ══ */}
      <div style={{ display: curKey === 'contacts' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

      {/* ── SECTION: Contacts (live client contacts — synced with Client 360) ── */}
      <FormSection title="Contacts" icon="👤">
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 12 }}>
          {disabled
            ? 'This visit is closed — contacts are read-only.'
            : 'Add, update, or remove the client’s contacts here — changes save to the client and appear in Client 360 automatically.'}
        </div>
        {contacts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px', color: 'var(--fg-3)', fontSize: 13 }}>
            No contacts on file yet.
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            {contacts.map((c, i) => (
              <div
                key={c.id}
                style={{
                  padding: '10px 0',
                  borderBottom: i < contacts.length - 1 ? '1px solid var(--line)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</span>
                  {c.is_primary && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--title)', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', borderRadius: 10, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Primary</span>
                  )}
                  {c.designation && <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>· {c.designation}</span>}
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 4, flexWrap: 'wrap', fontSize: 12, color: 'var(--fg-2)' }}>
                  {c.phone && <span>📞 {c.phone}</span>}
                  {c.email && <span>✉ {c.email}</span>}
                  {c.whatsapp && <span>💬 {c.whatsapp}</span>}
                </div>
                {c.notes && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4, fontStyle: 'italic', lineHeight: 1.4 }}>{c.notes}</div>}
                {!disabled && (
                  <EditContactButton
                    contact={{ id: c.id, name: c.name, designation: c.designation, phone: c.phone, email: c.email, whatsapp: c.whatsapp, notes: c.notes, is_primary: c.is_primary }}
                    clientId={Number(visit.client_id)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {!disabled && <AddContactButton clientId={Number(visit.client_id)} clientCode={visit.code} />}
      </FormSection>

      </div>{/* end contacts */}


      {/* ══ STEP: Sugar — RIL pump install base ══ */}
      <div style={{ display: curKey === 'sugar1' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>
        {isSugar && (
          <FormSection title="RIL Pump Install Base" icon="🍬">
            <SugarSection report={sugarReport} visitId={visit.id} disabled={disabled} queueSave={queueSave} hasComplaints={hasComplaints} setHasComplaints={setHasComplaints} part="pumps" />
          </FormSection>
        )}
      </div>{/* end sugar1 */}

      {/* ══ STEP: Sugar — Commercial discussion ══ */}
      <div style={{ display: curKey === 'sugar2' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>
        {isSugar && (
          <FormSection title="Commercial Discussion" icon="💬">
            <SugarSection report={sugarReport} visitId={visit.id} disabled={disabled} queueSave={queueSave} hasComplaints={hasComplaints} setHasComplaints={setHasComplaints} part="commercial" />
          </FormSection>
        )}
      </div>{/* end sugar2 */}

      {/* ══ STEP: Non-Sugar Report ══ */}
      <div style={{ display: curKey === 'nonsugar' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>
        {!isSugar && (
          <FormSection title="Non-Sugar Report" icon="🏭">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={LBL}>Deal In (products)</label>
                <input type="text" defaultValue={String(nonsugarReport?.deal_in ?? '')} disabled={disabled} onChange={e => queueSave('deal_in', e.target.value)} style={INP} placeholder="e.g. PCP, MMP, Spares" />
              </div>
              <div>
                <label style={LBL}>Valves / Equipment Observed</label>
                <textarea defaultValue={String(nonsugarReport?.valves_observed_notes ?? '')} disabled={disabled} onChange={e => queueSave('valves_observed_notes', e.target.value)} rows={3} style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }} placeholder="Notes on valves and equipment observed…" />
              </div>
            </div>
          </FormSection>
        )}
      </div>{/* end nonsugar */}

      {/* ══ STEP: Equipment & Competition ══ */}
      <div style={{ display: curKey === 'equipment' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

      {/* ── SECTION 5: Equipment Assessment ───────────────── */}
      <FormSection title="Equipment Assessment" icon="⚙️">
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', marginBottom: 12 }}>
          {[['ril', 'RIL Equipment'], ['competitor', 'Competitor Equipment']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setEqTab(id as 'ril' | 'competitor'); setShowEqForm(false); }}
              style={{
                padding: '7px 16px', border: 'none', background: 'none',
                fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                fontWeight: eqTab === id ? 600 : 400,
                color: eqTab === id ? 'var(--title)' : 'var(--fg-3)',
                borderBottom: eqTab === id ? '2px solid var(--title)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {label}
              {id === 'ril' && (rilPumpCount ?? 0) > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--accent-soft)', color: 'var(--title)', padding: '1px 5px', borderRadius: 8 }}>
                  {rilPumpCount}
                </span>
              )}
              {id === 'competitor' && compEquipment.length > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--neg-soft)', color: 'var(--neg-strong)', padding: '1px 5px', borderRadius: 8 }}>
                  {compEquipment.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* RIL tab → editable client pumps (writes to client_pumps directly).
            Competitor tab → the existing equipment capture. */}
        {eqTab === 'ril' && <ClientPumpEditor clientId={visit.client_id} onCount={setRilPumpCount} />}

        {/* cast avoids narrowing eqTab to 'competitor' so the inner tab checks still type-check */}
        {(eqTab as string) === 'competitor' && (<>
        {/* Equipment list */}
        {(eqTab === 'ril' ? rilEquipment : compEquipment).length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px', color: 'var(--fg-3)', fontSize: 13 }}>
            No {eqTab === 'ril' ? 'RIL' : 'competitor'} equipment recorded
          </div>
        ) : (
          <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-elev)' }}>
                {['Type', 'Supplier/Model', 'Application', 'Qty', 'Condition', eqTab === 'ril' ? 'Feedback' : 'Reason'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)', borderBottom: '1px solid var(--line)' }}>{h}</th>
                ))}
                {!disabled && <th style={{ padding: '7px 10px', borderBottom: '1px solid var(--line)' }} />}
              </tr>
            </thead>
            <tbody>
              {(eqTab === 'ril' ? rilEquipment : compEquipment).map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td data-label="" style={{ padding: '8px 10px' }}>{String(e.supplier ?? '')} {String(e.model ?? '')}</td>
                  <td data-label="Type" style={{ padding: '8px 10px' }}>{String(e.pump_type ?? '—')}</td>
                  <td data-label="Application" style={{ padding: '8px 10px', color: 'var(--fg-3)' }}>{String(e.application ?? '—')}</td>
                  <td data-label="Qty" style={{ padding: '8px 10px', textAlign: 'center' }}>{String(e.qty ?? 1)}</td>
                  <td data-label="Condition" style={{ padding: '8px 10px' }}>
                    <span style={{
                      fontSize: 11, padding: '2px 6px', borderRadius: 4,
                      background: e.condition === 'EOL' ? 'var(--neg-soft)'
                        : (e.condition === 'Good' || e.condition === 'Running') ? 'var(--pos-soft)'
                        : e.condition === 'Standby' ? 'var(--accent-soft)' : 'var(--warn-soft)',
                      color: e.condition === 'EOL' ? 'var(--neg-strong)'
                        : (e.condition === 'Good' || e.condition === 'Running') ? 'var(--pos-strong)'
                        : e.condition === 'Standby' ? 'var(--brand-blue)' : 'var(--warn)',
                    }}>
                      {String(e.condition ?? '—')}
                    </span>
                    {Boolean(e.is_opportunity) && <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--brand-blue)' }}>⚡ Opp</span>}
                    {e.condition_remark ? (
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3, lineHeight: 1.4 }}>{String(e.condition_remark)}</div>
                    ) : null}
                  </td>
                  <td data-label={eqTab === 'ril' ? 'Feedback' : 'Reason'} style={{ padding: '8px 10px', color: 'var(--fg-3)', fontSize: 11 }}>
                    {eqTab === 'ril' ? String(e.performance_feedback ?? '—') : String(e.reason_for_competitor ?? '—')}
                  </td>
                  {!disabled && (
                    <td data-label="Actions" style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => {
                          const sup = String(e.supplier ?? '');
                          setEditingEqId(Number(e.id));
                          setShowEqForm(true);
                          setSupplierOther(eqTab === 'competitor' && sup !== '' && !COMPETITOR_MAKES.includes(sup));
                          setNewEq({
                            pump_type: String(e.pump_type ?? 'PCP'),
                            supplier: sup,
                            model: String(e.model ?? ''),
                            qty: String(e.qty ?? 1),
                            application: String(e.application ?? ''),
                            condition: String(e.condition ?? 'Good'),
                            condition_remark: String(e.condition_remark ?? ''),
                            is_ril: Boolean(e.is_ril),
                            reason_for_competitor: String(e.reason_for_competitor ?? ''),
                            competitor_activity_type: String(e.competitor_activity_type ?? ''),
                            performance_feedback: String(e.performance_feedback ?? ''),
                            // Without these the edit form would open blank on the
                            // duty fields and write those blanks back on save,
                            // erasing whatever the row already held.
                            capacity_m3h: e.capacity_m3h == null ? '' : String(e.capacity_m3h),
                            head_m:       e.head_m       == null ? '' : String(e.head_m),
                            kw:           e.kw           == null ? '' : String(e.kw),
                            drive_system: String(e.drive_system ?? ''),
                            moc:          String(e.moc ?? ''),
                          });
                        }}
                        className="r-tap"
                        style={{ fontSize: 11, color: 'var(--title)', background: 'none', border: '1px solid var(--title)', borderRadius: 5, padding: '3px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (typeof window !== 'undefined' && !window.confirm('Delete this equipment entry? This cannot be undone.')) return;
                          if (editingEqId === Number(e.id)) { setShowEqForm(false); setEditingEqId(null); }
                          const res = await deleteEquipment(Number(e.id), visit.id);
    if (!res.ok) { setActionError(res.error); return; }
    setActionError('');
                        }}
                        className="r-tap"
                        style={{ fontSize: 11, color: 'var(--neg)', background: 'none', border: '1px solid var(--neg)', borderRadius: 5, padding: '3px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Delete
                      </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Add equipment form */}
        {!disabled && !showEqForm && (
          <button
            onClick={() => { setShowEqForm(true); setEditingEqId(null); setSupplierOther(false); setNewEq(prev => ({ ...prev, is_ril: eqTab === 'ril', supplier: eqTab === 'ril' ? 'RIL' : '' })); }}
            style={{ fontSize: 12, color: 'var(--title)', background: 'none', border: '1px dashed var(--title)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            + Add {eqTab === 'ril' ? 'RIL' : 'Competitor'} Equipment
          </button>
        )}

        {showEqForm && !disabled && (
          <div style={{ padding: 14, background: 'var(--bg-elev)', borderRadius: 8, border: '1px solid var(--line)', marginTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={LBL}>Pump Type</label>
                <select value={newEq.pump_type} onChange={e => setNewEq(p => ({ ...p, pump_type: e.target.value }))} style={INP}>
                  {['PCP', 'MMP', 'Rota', 'Centrifugal', 'Other'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              {eqTab === 'competitor' && (
                <div>
                  <label style={LBL}>Competitor / Make</label>
                  <select
                    value={supplierOther ? '__other__' : newEq.supplier}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '__other__') { setSupplierOther(true); setNewEq(p => ({ ...p, supplier: '' })); }
                      else { setSupplierOther(false); setNewEq(p => ({ ...p, supplier: v })); }
                    }}
                    style={{ ...INP, appearance: 'none' }}
                  >
                    <option value="">Select competitor…</option>
                    {COMPETITOR_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                    <option value="__other__">Other (specify)…</option>
                  </select>
                  {supplierOther && (
                    <input
                      type="text"
                      value={newEq.supplier}
                      onChange={e => setNewEq(p => ({ ...p, supplier: e.target.value }))}
                      style={{ ...INP, marginTop: 6 }}
                      placeholder="Enter competitor name"
                    />
                  )}
                </div>
              )}
              <div>
                <label style={LBL}>Model</label>
                <input type="text" value={newEq.model} onChange={e => setNewEq(p => ({ ...p, model: e.target.value }))} style={INP} />
              </div>
              <div>
                <label style={LBL}>Application</label>
                <input type="text" value={newEq.application} onChange={e => setNewEq(p => ({ ...p, application: e.target.value }))} style={INP} />
              </div>
              <div>
                <label style={LBL}>Qty</label>
                {/* Kept as a raw string (see newEq state) so the field can be cleared
                    while typing and an explicit "0" isn't indistinguishable from
                    empty — both used to collapse to the same blank display. */}
                <input type="number" inputMode="numeric" min={0} value={newEq.qty}
                  onChange={e => setNewEq(p => ({ ...p, qty: e.target.value }))}
                  style={INP} />
              </div>
              <div>
                <label style={LBL}>Condition</label>
                <select value={newEq.condition} onChange={e => setNewEq(p => ({ ...p, condition: e.target.value }))} style={INP}>
                  {['Running', 'Standby', 'Good', 'Requires Maintenance', 'EOL'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Duty and build. Every one of these columns already existed and was
                already saved by the action — there was simply never an input, so
                all 239 equipment records carry NULL. Optional: a rep who does not
                have the nameplate to hand leaves them blank. */}
            <div className="r-grid-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                <label style={LBL}>Capacity (m³/hr)</label>
                <input type="number" inputMode="decimal" min={0} step="any" value={newEq.capacity_m3h}
                  onChange={e => setNewEq(p => ({ ...p, capacity_m3h: e.target.value }))}
                  placeholder="e.g. 25" style={INP} />
              </div>
              <div>
                <label style={LBL}>Head (m)</label>
                <input type="number" inputMode="decimal" min={0} step="any" value={newEq.head_m}
                  onChange={e => setNewEq(p => ({ ...p, head_m: e.target.value }))}
                  placeholder="e.g. 40" style={INP} />
              </div>
              <div>
                <label style={LBL}>Power (kW)</label>
                <input type="number" inputMode="decimal" min={0} step="any" value={newEq.kw}
                  onChange={e => setNewEq(p => ({ ...p, kw: e.target.value }))}
                  placeholder="e.g. 7.5" style={INP} />
              </div>
            </div>

            <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                <label style={LBL}>Drive System</label>
                <select value={newEq.drive_system} onChange={e => setNewEq(p => ({ ...p, drive_system: e.target.value }))} style={INP}>
                  <option value="">—</option>
                  {DRIVE_SYSTEMS.map(d => <option key={d} value={d}>{d}</option>)}
                  {/* Keep a legacy value that is not on the list rather than
                      silently switching the row to blank on the next save. */}
                  {newEq.drive_system && !DRIVE_SYSTEMS.includes(newEq.drive_system) && (
                    <option value={newEq.drive_system}>{newEq.drive_system}</option>
                  )}
                </select>
              </div>
              <div>
                <label style={LBL}>MOC</label>
                <select value={newEq.moc} onChange={e => setNewEq(p => ({ ...p, moc: e.target.value }))} style={INP}>
                  <option value="">—</option>
                  {MOC_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                  {newEq.moc && !MOC_OPTIONS.includes(newEq.moc) && (
                    <option value={newEq.moc}>{newEq.moc}</option>
                  )}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={LBL}>Performance Feedback</label>
              <input type="text" value={newEq.performance_feedback}
                onChange={e => setNewEq(p => ({ ...p, performance_feedback: e.target.value }))}
                placeholder="How is it performing in service?" style={INP} />
            </div>

            {/* Only meaningful for someone else's pump — asking why a RIL pump is
                a competitor's would be nonsense. */}
            {eqTab === 'competitor' && (
              <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div>
                  <label style={LBL}>Why this make?</label>
                  <input type="text" value={newEq.reason_for_competitor}
                    onChange={e => setNewEq(p => ({ ...p, reason_for_competitor: e.target.value }))}
                    placeholder="Price, lead time, OEM tie-up…" style={INP} />
                </div>
                <div>
                  <label style={LBL}>Competitor Activity</label>
                  <select value={newEq.competitor_activity_type}
                    onChange={e => setNewEq(p => ({ ...p, competitor_activity_type: e.target.value }))} style={INP}>
                    <option value="">—</option>
                    {COMPETITOR_ACTIVITY.map(a => <option key={a} value={a}>{a}</option>)}
                    {newEq.competitor_activity_type && !COMPETITOR_ACTIVITY.includes(newEq.competitor_activity_type) && (
                      <option value={newEq.competitor_activity_type}>{newEq.competitor_activity_type}</option>
                    )}
                  </select>
                </div>
              </div>
            )}

            <div style={{ marginBottom: 10 }}>
              <label style={LBL}>Condition Remark</label>
              <textarea
                value={newEq.condition_remark}
                onChange={e => setNewEq(p => ({ ...p, condition_remark: e.target.value }))}
                rows={2}
                placeholder="Notes on the pump's condition / status…"
                style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>

            {newEq.condition === 'EOL' && eqTab === 'competitor' && (
              <div style={{ padding: '8px 12px', background: 'var(--accent-soft)', borderRadius: 6, fontSize: 12, color: 'var(--brand-blue)', marginBottom: 10 }}>
                ⚡ EOL detected — a displacement opportunity will be flagged on submit
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={async () => {
                  // Blank/invalid falls back to 1 (a sensible default for a new
                  // entry); an explicit 0 is honoured rather than snapped to 1.
                  const parsedQty = parseInt(newEq.qty, 10);
                  const qtyNum = Number.isFinite(parsedQty) && parsedQty >= 0 ? parsedQty : 1;
                  // capacity / head / kW are numeric columns. Left blank they must
                  // arrive as undefined so the action's `?? null` writes NULL —
                  // an empty string would be rejected by Postgres outright.
                  const num = (v: string) => {
                    const n = parseFloat(v);
                    return Number.isFinite(n) && n >= 0 ? n : undefined;
                  };
                  // Blank text arrives as undefined too, so the action's `?? null`
                  // writes NULL rather than an empty string. Without this, an
                  // untouched field is stored as '' and is indistinguishable from
                  // one someone deliberately cleared — which is precisely what
                  // makes a "how often is this filled?" check meaningless.
                  const str = (v: string) => (v.trim() === '' ? undefined : v.trim());
                  const eqPayload = {
                    ...newEq,
                    qty: qtyNum,
                    capacity_m3h: num(newEq.capacity_m3h),
                    head_m: num(newEq.head_m),
                    kw: num(newEq.kw),
                    drive_system: str(newEq.drive_system),
                    moc: str(newEq.moc),
                    performance_feedback: str(newEq.performance_feedback),
                    reason_for_competitor: str(newEq.reason_for_competitor),
                    competitor_activity_type: str(newEq.competitor_activity_type),
                  };
                  if (editingEqId != null) {
                    const res = await updateEquipment(editingEqId, visit.id, eqPayload);
      if (!res.ok) { setActionError(res.error); return; }
      setActionError('');
                  } else {
                    const res = await addEquipment(visit.id, visit.client_id, eqPayload);
      if (!res.ok) { setActionError(res.error); return; }
      setActionError('');
                  }
                  setShowEqForm(false);
                  setEditingEqId(null);
                  setSupplierOther(false);
                  setNewEq({ pump_type: 'PCP', supplier: '', model: '', qty: '1', application: '', condition: 'Good', condition_remark: '', is_ril: true, reason_for_competitor: '', competitor_activity_type: '', performance_feedback: '', capacity_m3h: '', head_m: '', kw: '', drive_system: '', moc: '' });
                }}
                style={{ padding: '7px 14px', background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}
              >
                {editingEqId != null ? 'Update Equipment' : 'Save Equipment'}
              </button>
              <button
                onClick={() => { setShowEqForm(false); setEditingEqId(null); setSupplierOther(false); }}
                style={{ padding: '7px 14px', background: 'none', border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        </>)}
      </FormSection>

      </div>{/* end STEP 3 */}

      {/* ══ STEP: Opportunities ══ */}
      <div style={{ display: curKey === 'opps' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

      {/* ── SECTION: Expansion / New Business ───────────────── */}
      <FormSection title="Expansion / New Business" icon="⚡">
        <ExpansionOpportunityForm
          visitId={Number(visit.id)}
          clientId={Number(visit.client_id)}
          clientName={visit.legal_name}
          repId={visit.rep_id ? Number(visit.rep_id) : null}
          isClosed={disabled}
          existingOpp={expansionOpp}
          reps={reps}
        />
      </FormSection>

      {/* ── SECTION: Complaint ──────────────────────────────── */}
      <FormSection title="Complaint" icon="⚠">
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 10 }}>
          Raise a service / product complaint for {visit.legal_name} and escalate it to a responsible person.
        </div>
        <LogComplaintButton clientId={Number(visit.client_id)} clientName={visit.legal_name} />
      </FormSection>

      </div>{/* end opps */}

      {/* ══ STEP: Client Type ══ */}
      <div style={{ display: curKey === 'clienttype' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>
      <FormSection title="Client Type" icon="🏷️">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <label style={LBL}>What is the client type?</label>
              <span style={{ fontSize: 11, fontWeight: 600, minHeight: 14 }}>
                {ctSaved && <span style={{ color: '#0A7D34' }}>✓ Saved</span>}
                {ctError && <span style={{ color: '#B91C1C' }}>⚠ Save failed — try again</span>}
              </span>
            </div>
            <select
              value={clientType}
              disabled={disabled}
              onChange={e => {
                const v = e.target.value;
                setClientType(v);
                saveClientProfile({ client_type: v || null });
                if (!isEpcOem(v)) clearEpcState();   // server retires EPC fields; mirror it here
              }}
              style={{ ...INP, appearance: 'none', maxWidth: 320 }}
            >
              <option value="">— Select —</option>
              {CLIENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 6 }}>
              This updates the client record. Selecting <strong>EPC</strong> or <strong>OEM</strong> adds a few account questions below.
            </div>
          </div>

          {/* TCD — a client-level plant capacity, prefilled from the client and
              saved back to it, so it stays in sync with Client 360 either way. */}
          <div>
            <label style={LBL}>TCD (Tonnes Cane/Day)</label>
            <input
              type="number" inputMode="numeric" min={0} value={tcd} disabled={disabled}
              onChange={e => setTcd(e.target.value)}
              onBlur={e => saveClientProfile({ tcd: numOrNull(e.target.value) })}
              style={{ ...INP, maxWidth: 320 }} placeholder="e.g. 2500"
            />
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 6 }}>
              Plant crushing capacity. Updates the client record — visible and editable on Client 360.
            </div>
          </div>

          {showEpcOem && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5 }}>
                For every {clientType}, please secure the following (all optional):
              </div>

              {/* Focus industries — multiselect chips */}
              <div>
                <label style={LBL}>Focus across which industries?</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {focusChips.length === 0 && <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>No industries available.</span>}
                  {focusChips.map(ind => {
                    const on = focusInd.includes(ind);
                    return (
                      <button
                        key={ind} type="button" disabled={disabled}
                        onClick={() => {
                          const next = on ? focusInd.filter(x => x !== ind) : [...focusInd, ind];
                          setFocusInd(next); saveClientProfile({ focus_industries: next });
                        }}
                        style={{
                          padding: '5px 11px', borderRadius: 14, fontSize: 12, lineHeight: 1,
                          cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
                          border: `1px solid ${on ? 'var(--accent)' : 'var(--line-strong)'}`,
                          background: on ? 'var(--accent)' : 'var(--bg-paper)',
                          color: on ? '#fff' : 'var(--fg-2)',
                        }}
                      >
                        {ind}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={LBL}>Avg annual pump requirement</label>
                  <input
                    type="number" inputMode="numeric" min={0} value={avgPumpReq} disabled={disabled}
                    onChange={e => setAvgPumpReq(e.target.value)}
                    onBlur={e => saveClientProfile({ avg_annual_pump_req: numOrNull(e.target.value) })}
                    style={INP} placeholder="e.g. 40 pumps / yr"
                  />
                </div>
                <div>
                  <label style={LBL}>Ongoing tenders</label>
                  <input
                    type="number" inputMode="numeric" min={0} value={ongoingTenders} disabled={disabled}
                    onChange={e => setOngoingTenders(e.target.value)}
                    onBlur={e => saveClientProfile({ ongoing_tenders: numOrNull(e.target.value) })}
                    style={INP} placeholder="e.g. 3"
                  />
                </div>
              </div>

              <div>
                <CheckboxField
                  label="Upcoming tenders / projects?"
                  checked={upcomingTenders}
                  disabled={disabled}
                  onChange={v => {
                    setUpcomingTenders(v);
                    if (!v) { setUpcomingDetails(''); saveClientProfile({ upcoming_tenders: false, upcoming_tenders_details: null }); }
                    else saveClientProfile({ upcoming_tenders: true });
                  }}
                />
                {upcomingTenders && (
                  <div style={{ marginTop: 8, paddingLeft: 22 }}>
                    <label style={LBL}>Details — which projects / tenders</label>
                    <textarea
                      value={upcomingDetails} disabled={disabled}
                      onChange={e => setUpcomingDetails(e.target.value)}
                      onBlur={e => saveClientProfile({ upcoming_tenders_details: e.target.value.trim() || null })}
                      rows={3} style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }}
                      placeholder="Projects / tenders, timelines, scope, expected pump demand…"
                    />
                  </div>
                )}
              </div>

              <div>
                <label style={LBL}>PC pump suppliers (competitor footprint)</label>
                <textarea
                  value={pcpSuppliers} disabled={disabled}
                  onChange={e => setPcpSuppliers(e.target.value)}
                  onBlur={e => saveClientProfile({ pcp_suppliers: e.target.value.trim() || null })}
                  rows={3} style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }}
                  placeholder="Which PC pump makes they currently buy / prefer, and roughly what share…"
                />
              </div>
            </div>
          )}
        </div>
      </FormSection>
      </div>{/* end clienttype */}

      {/* ══ STEP: Visit Summary ══ */}
      <div style={{ display: curKey === 'summary' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

      {/* ── SECTION 6: Visit Summary ───────────────────────── */}
      <FormSection title="Visit Summary" icon="📝">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL}>Performance Feedback</label>
              <select defaultValue={visit.performance_feedback ?? ''} disabled={disabled} onChange={e => queueSave('performance_feedback', e.target.value)} style={{ ...INP, appearance: 'none' }}>
                <option value="">—</option>
                {['Good', 'Average', 'Poor'].map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Mgmt Intervention</label>
              <select defaultValue={visit.mgmt_intervention ?? ''} disabled={disabled} onChange={e => queueSave('mgmt_intervention', e.target.value)} style={{ ...INP, appearance: 'none' }}>
                <option value="">—</option>
                {['YES', 'NO', 'NIL'].map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Boolean flags */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <CheckboxField
              label="Competitor activity observed?"
              checked={compActivity}
              disabled={disabled}
              onChange={v => { setCompActivity(v); queueSave('competitor_activity_observed', v); }}
            />
            <CheckboxField
              label="Sample / gift given?"
              checked={sampleGiven}
              disabled={disabled}
              onChange={v => { setSampleGiven(v); queueSave('sample_or_gift_given', v); }}
            />
            {sampleGiven && (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, paddingLeft: 22 }}>
                <div>
                  <label style={LBL}>Sample/Gift Detail</label>
                  <input type="text" defaultValue={visit.sample_gift_detail ?? ''} disabled={disabled} onChange={e => queueSave('sample_gift_detail', e.target.value)} style={INP} />
                </div>
                <div>
                  <label style={LBL}>Value (₹)</label>
                  <input type="number" inputMode="decimal" defaultValue={visit.sample_gift_value ?? ''} disabled={disabled} onChange={e => queueSave('sample_gift_value', e.target.value)} style={INP} />
                </div>
              </div>
            )}
            <CheckboxField
              label="Follow-up required?"
              checked={followUp}
              disabled={disabled}
              onChange={v => { setFollowUp(v); queueSave('follow_up_required', v); }}
            />
            {followUp && (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, paddingLeft: 22 }}>
                <div>
                  <label style={LBL}>Follow-up details</label>
                  <input type="text" defaultValue={visit.follow_up_text ?? ''} disabled={disabled} onChange={e => queueSave('follow_up_text', e.target.value)} style={INP} placeholder="What needs to be done?" />
                </div>
                <div>
                  <label style={LBL}>Due date</label>
                  <input type="date" defaultValue={visit.follow_up_due_date ?? ''} disabled={disabled} onChange={e => queueSave('follow_up_due_date', e.target.value)} style={INP} />
                </div>
              </div>
            )}
          </div>

          {/* Next visit */}
          <div>
            <label style={LBL}>Next Visit Recommendation</label>
            <input type="date" defaultValue={visit.next_visit_recommendation ?? ''} disabled={disabled} onChange={e => queueSave('next_visit_recommendation', e.target.value)} style={{ ...INP, maxWidth: 200 }} />
          </div>

          {/* Summary text */}
          <div>
            <label style={LBL}>Visit Summary *</label>
            <SummaryTextarea
              defaultValue={visit.summary ?? ''}
              disabled={disabled}
              onSave={(v) => queueSave('summary', v)}
              maxLength={1000}
            />
          </div>

          <div>
            <label style={LBL}>Open Remarks</label>
            <textarea defaultValue={visit.open_remarks ?? ''} disabled={disabled} onChange={e => queueSave('open_remarks', e.target.value)} rows={2} style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </div>
      </FormSection>

      </div>{/* end summary */}

      {/* ══ STEP: Site Photos ══ */}
      <div style={{ display: curKey === 'photos' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>
      <FormSection title="Site Photos" icon="📷">
        <VisitPhotos visitId={visit.id} disabled={disabled} />
      </FormSection>
      </div>{/* end photos */}

      {/* ══ STEP: Action Register ══ */}
      <div style={{ display: curKey === 'actions' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

      {/* ── SECTION: Action Points ─────────────────────────── */}
      <FormSection title="Action Register" icon="📋">
        {tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--fg-3)', fontSize: 13 }}>
            No action points yet.{!disabled && ' Click "+ Add Action Point" to create one.'}
          </div>
        ) : (
          tasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              isClosed={disabled}
              onComplete={handleCompleteTask}
              onDelete={handleDeleteTask}
            />
          ))
        )}
        {resolvingTask && (
          <ResolveActionDialog
            action={resolvingTask}
            onCancel={() => setResolvingTask(null)}
            onDone={() => { setResolvingTask(null); router.refresh(); }}
          />
        )}
        {!disabled && (
          <AddActionForm
            visitId={Number(visit.id)}
            clientId={Number(visit.client_id)}
            reps={reps}
            defaultRepId={visit.rep_id ? Number(visit.rep_id) : null}
            onAdded={() => router.refresh()}
          />
        )}
      </FormSection>

      {/* ── SECTION 7: Preview (before submit) — drafts only ─────── */}
      {!isSubmitted && !disabled && willPreview && (
        <div style={{
          border: '1px solid var(--brand-blue)', borderRadius: 8, padding: 16,
          background: 'var(--accent-soft)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--title)', marginBottom: 10 }}>
            On Submit, the following will be created:
          </div>
          {followUp && (
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              ✅ Follow-up task for {visit.legal_name}
              {visit.follow_up_due_date ? ` · due ${visit.follow_up_due_date}` : ''}
            </div>
          )}
          {dispOpps.length > 0 && (
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              ⚡ {dispOpps.length} displacement opportunit{dispOpps.length === 1 ? 'y' : 'ies'} from EOL competitor equipment
            </div>
          )}
        </div>
      )}

      {/* Auto-created opportunities (tasks now live in the Action Points section above) */}
      {opportunities.length > 0 && (
        <FormSection title="Auto-Created Opportunities" icon="⚡" defaultOpen={false}>
          <div>
            {opportunities.map((o, i) => (
              <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-elev)', borderRadius: 6, fontSize: 12, marginBottom: 4 }}>
                <span style={{ fontWeight: 500 }}>{String(o.product ?? '—')}</span>
                <span style={{ color: 'var(--fg-3)', marginLeft: 8 }}>{String(o.stage ?? '')} · {String(o.auto_source ?? '')}</span>
              </div>
            ))}
          </div>
        </FormSection>
      )}

      </div>{/* end actions */}

      {/* ── Sticky wizard navigation (pinned to the bottom of the page) ── */}
      <div className="wizard-nav" style={{
        position: 'sticky', bottom: 0, zIndex: 9, marginTop: 6,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px',
        background: 'var(--bg-paper)', border: '1px solid var(--line)',
        borderRadius: 12, boxShadow: '0 -4px 16px rgba(10, 22, 40, 0.06)',
      }}>
        <button
          type="button" onClick={() => goStep(step - 1)} disabled={step === 0}
          style={{
            padding: '11px 18px', borderRadius: 9, border: '1px solid var(--line-strong)',
            background: 'var(--bg-paper)', color: step === 0 ? 'var(--fg-3)' : 'var(--fg)',
            cursor: step === 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'inherit',
            opacity: step === 0 ? 0.45 : 1, fontWeight: 600,
          }}
        >
          Back
        </button>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {step + 1} / {steps.length}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          {step < LAST ? (
            <button
              type="button" onClick={() => goStep(step + 1)}
              style={{
                padding: '11px 22px', borderRadius: 9, border: 'none', background: 'var(--accent-fill)',
                color: 'var(--on-accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                boxShadow: '0 2px 8px rgba(26, 92, 184, 0.3)',
              }}
            >
              Next
            </button>
          ) : !isSubmitted ? (
            // A draft: submit to close it (if the viewer may edit).
            !disabled
              ? <SubmitVisitButton visitId={visit.id} />
              : <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>🔒 View only</span>
          ) : reopened ? (
            // Already closed, re-opened for correction: no re-submit — just finish.
            <button
              type="button" onClick={() => setReopened(false)}
              style={{ padding: '11px 22px', borderRadius: 9, border: '1px solid var(--title)', background: 'var(--bg-paper)', color: 'var(--title)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}
            >
              Done editing
            </button>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>🔒 Closed{closedDate ? ` on ${closedDate}` : ''} — read only</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function FormSection({
  title, icon, children, defaultOpen = true,
}: {
  title: string; icon?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${title} section, ${open ? 'expanded' : 'collapsed'}`}
        onClick={() => setOpen(!open)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
        style={{
          padding: '12px 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', cursor: 'pointer',
          borderBottom: open ? '1px solid var(--line)' : 'none',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon} {title}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="var(--fg-3)" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '200ms', flexShrink: 0 }}>
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </div>
      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
}

function CheckInButton({ visitId, onDone }: { visitId: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  // Single entry point that always catches — the server action can never
  // produce an unhandled rejection that crashes the page.
  const doCheckIn = async (
    lat: number | null, lng: number | null, accuracy: number | null,
    manual: boolean, manualNote: string | null,
  ) => {
    try {
      const res = await checkInVisit({ visitId, lat, lng, accuracy, manual, manualNote: manualNote ?? undefined });
      // This button has its own error line; the form-level banner is for the
      // controls that do not.
      if (!res.ok) { setError(res.error); setLoading(false); return; }
      setError('');
      onDone();
    } catch (err: unknown) {
      console.error('Check-in error:', err);
      setError(err instanceof Error ? err.message : 'Check-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handle = async () => {
    setLoading(true); setError('');

    // Geolocation may be absent (insecure context / unsupported webview) —
    // fall back to a manual check-in instead of throwing.
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      await doCheckIn(null, null, null, true, 'GPS not supported on this device');
      return;
    }

    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(
          res, rej,
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        ),
      );
      await doCheckIn(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, false, null);
    } catch (gpsErr: unknown) {
      const code = (gpsErr as GeolocationPositionError)?.code;
      console.error('GPS error:', code, (gpsErr as Error)?.message);
      const reason =
        code === 1 ? 'Location permission denied'
        : code === 2 ? 'Location unavailable'
        : code === 3 ? 'Location request timed out'
        : 'GPS error: ' + ((gpsErr as Error)?.message ?? 'unknown');
      // Graceful fallback — record a manual check-in so the visit can still start.
      await doCheckIn(null, null, null, true, reason);
    }
  };

  const manualCheckIn = () => {
    setLoading(true); setError('');
    return doCheckIn(null, null, null, true, 'Manual check-in');
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={handle} disabled={loading}
          style={{
            padding: '10px 20px', background: 'var(--accent-fill)', color: 'var(--on-accent)',
            border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
            cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Getting location…' : '📍 Start Visit'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', fontStyle: 'italic' }}>
          Your GPS coordinates will be recorded
        </span>
      </div>
      {error && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--warn)' }}>{error}</span>
          <button
            type="button" onClick={manualCheckIn} disabled={loading}
            style={{
              padding: '5px 12px', borderRadius: 6, border: '1px solid var(--line-strong)',
              background: 'var(--bg-paper)', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 12, fontFamily: 'inherit', color: 'var(--fg-2)',
            }}
          >
            Check in without GPS
          </button>
        </div>
      )}
    </div>
  );
}

function SugarSection({
  report, visitId, disabled, queueSave, hasComplaints, setHasComplaints, part = 'all',
}: {
  report: Record<string, unknown> | null;
  visitId: string; disabled: boolean;
  queueSave: (field: string, value: unknown) => void;
  hasComplaints: boolean; setHasComplaints: (v: boolean) => void;
  part?: 'all' | 'pumps' | 'commercial';
}) {
  const SCREW_APPS = ['molasses', 'magma', 'syrup', 'massecuite', 'melt', 'dosing', 'other'];
  const ROTA_APPS  = ['magma', 'massecuite'];

  const sugarField = (col: string) => Number(report?.[col] ?? 0);

  // Each Yes/No toggle needs its OWN controlled state — binding `value` to the
  // static report data left these stuck on their initial value when clicked.
  const [hasOutstanding, setHasOutstanding] = useState(!!(report?.has_outstanding_issues));
  const [pricesCaptured, setPricesCaptured] = useState(!!(report?.competitor_prices_captured));

  const showPumps = part === 'all' || part === 'pumps';
  const showCommercial = part === 'all' || part === 'commercial';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {showPumps && (<>
      {/* RIL Screw counts */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--title)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>RIL Screw Pumps Installed</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SCREW_APPS.map(app => (
            <div key={app} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'capitalize', marginBottom: 4 }}>{app}</div>
              <input
                type="number" inputMode="numeric" min={0}
                defaultValue={sugarField(`ril_screw_${app}`)}
                disabled={disabled}
                onChange={e => queueSave(`ril_screw_${app}`, parseInt(e.target.value) || 0)}
                style={{ ...INP, width: 60, textAlign: 'center' }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* RIL Rota counts */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--title)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>RIL Rota Pumps Installed</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {ROTA_APPS.map(app => (
            <div key={app} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'capitalize', marginBottom: 4 }}>{app}</div>
              <input
                type="number" inputMode="numeric" min={0}
                defaultValue={sugarField(`ril_rota_${app}`)}
                disabled={disabled}
                onChange={e => queueSave(`ril_rota_${app}`, parseInt(e.target.value) || 0)}
                style={{ ...INP, width: 60, textAlign: 'center' }}
              />
            </div>
          ))}
        </div>
      </div>
      </>)}

      {showCommercial && (<>
      {/* Commercial discussion */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--title)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Commercial Discussion</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Complaints */}
          <YesNoField
            label="Running complaints?"
            value={hasComplaints}
            disabled={disabled}
            onChange={v => { setHasComplaints(v); queueSave('has_complaints', v); }}
            detailLabel="Complaint details"
            defaultDetail={String(report?.complaints_detail ?? '')}
            onDetailChange={v => queueSave('complaints_detail', v)}
          />
          {/* Outstanding */}
          <YesNoField
            label="Outstanding payment / commercial issues?"
            value={hasOutstanding}
            disabled={disabled}
            onChange={v => { setHasOutstanding(v); queueSave('has_outstanding_issues', v); }}
            detailLabel="Details"
            defaultDetail={String(report?.outstanding_detail ?? '')}
            onDetailChange={v => queueSave('outstanding_detail', v)}
          />
        </div>
      </div>

      {/* Purchasing route */}
      <div>
        <label style={LBL}>Purchasing Route</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            defaultValue={String(report?.purchasing_route ?? '')}
            disabled={disabled}
            onChange={e => queueSave('purchasing_route', e.target.value)}
            style={{ ...INP, maxWidth: 200, appearance: 'none' }}
          >
            <option value="">— Select —</option>
            {['Direct', 'Through OEM', 'Trader'].map(r => <option key={r}>{r}</option>)}
          </select>
          <input
            type="text"
            defaultValue={String(report?.purchasing_route_detail ?? '')}
            disabled={disabled}
            onChange={e => queueSave('purchasing_route_detail', e.target.value)}
            style={{ ...INP, flex: 1 }}
            placeholder="Details…"
          />
        </div>
      </div>

      {/* Competitor prices */}
      <CheckboxField
        label="Competitor prices captured during visit?"
        checked={pricesCaptured}
        disabled={disabled}
        onChange={v => { setPricesCaptured(v); queueSave('competitor_prices_captured', v); }}
      />
      </>)}
    </div>
  );
}

function CheckboxField({
  label, checked, disabled, onChange,
}: {
  label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer' }}>
      <input
        type="checkbox" checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        style={{ width: 14, height: 14 }}
      />
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  );
}

function YesNoField({
  label, value, disabled, onChange, detailLabel, defaultDetail, onDetailChange, warningIfYes,
}: {
  label: string; value: boolean; disabled: boolean; onChange: (v: boolean) => void;
  detailLabel: string; defaultDetail: string; onDetailChange: (v: string) => void;
  warningIfYes?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: value ? 8 : 0 }}>
        <span style={{ fontSize: 13, flex: 1 }}>{label}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {[true, false].map(v => (
            <button
              key={String(v)}
              disabled={disabled}
              onClick={() => onChange(v)}
              style={{
                padding: '4px 12px', borderRadius: 5, fontSize: 12, cursor: disabled ? 'default' : 'pointer',
                fontFamily: 'inherit', border: value === v ? '2px solid var(--title)' : '1px solid var(--line-strong)',
                background: value === v ? 'var(--accent-soft)' : 'var(--bg-paper)',
                color: value === v ? 'var(--title)' : 'var(--fg-3)', fontWeight: value === v ? 600 : 400,
              }}
            >
              {v ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      </div>
      {value && (
        <>
          {warningIfYes && (
            <div style={{ fontSize: 11, color: 'var(--warn)', background: 'var(--warn-soft)', padding: '4px 8px', borderRadius: 4, marginBottom: 6 }}>
              {warningIfYes}
            </div>
          )}
          <textarea
            defaultValue={defaultDetail}
            disabled={disabled}
            onChange={e => onDetailChange(e.target.value)}
            rows={2}
            placeholder={`${detailLabel}…`}
            style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }}
          />
        </>
      )}
    </div>
  );
}

function SummaryTextarea({
  defaultValue, disabled, onSave, maxLength,
}: {
  defaultValue: string; disabled: boolean; onSave: (v: string) => void; maxLength: number;
}) {
  const [val, setVal] = useState(defaultValue);
  return (
    <div>
      <textarea
        value={val}
        disabled={disabled}
        onChange={e => { setVal(e.target.value); onSave(e.target.value); }}
        rows={4}
        maxLength={maxLength}
        style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }}
        placeholder="Summarise the key points discussed and outcomes of the visit…"
      />
      <div style={{ textAlign: 'right', fontSize: 10, color: val.length > maxLength * 0.9 ? 'var(--neg)' : 'var(--fg-3)', marginTop: 2 }}>
        {val.length} / {maxLength}
      </div>
    </div>
  );
}

// ── Expansion / New Business ───────────────────────────────────

function ExpansionOpportunityForm({ visitId, clientId, clientName, repId, isClosed, existingOpp, reps }: {
  visitId: number;
  clientId: number;
  clientName: string;
  repId: number | null;
  isClosed: boolean;
  existingOpp: ExpansionOpp | null;
  reps: TaskRep[];
}) {
  const [hasExpansion, setHasExpansion] = useState(!!existingOpp);
  const [tsmMode, setTsmMode]                 = useState<'none' | 'internal' | 'external'>(
    existingOpp?.tsm_user_id ? 'internal' : (existingOpp?.tsm_external ? 'external' : 'none'));
  const [tsmUserId, setTsmUserId]             = useState(existingOpp?.tsm_user_id?.toString() ?? '');
  const [tsmExternal, setTsmExternal]         = useState(existingOpp?.tsm_external ?? '');
  const [tsmExternalEmail, setTsmExternalEmail] = useState(existingOpp?.tsm_external_email ?? '');
  const [product, setProduct]           = useState(existingOpp?.product ?? '');
  const [productType, setProductType]   = useState(existingOpp?.product_type ?? 'PCP');
  const [stage, setStage]               = useState(existingOpp?.stage ?? 'Suspect');
  const [valueInr, setValueInr]         = useState(
    existingOpp?.value_cr ? String(Math.round(parseFloat(String(existingOpp.value_cr)) * 10_000_000)) : '',
  );
  const [probabilityCode, setProbabilityCode] = useState(existingOpp?.probability_code ?? '');
  // This section saves itself as it is typed, so a refusal has no button to
  // report against — it gets a line of its own under the fields.
  const [expansionError, setExpansionError] = useState('');
  const [etaText, setEtaText]           = useState(existingOpp?.eta_text ?? '');
  const [quoteRef, setQuoteRef]         = useState(existingOpp?.quote_ref ?? '');
  const [notes, setNotes]               = useState(existingOpp?.notes ?? '');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted   = useRef(false);

  // Debounced live upsert: the opportunity is created/updated as the form is
  // filled and deleted when toggled to No. Skips the initial mount so opening
  // an existing report doesn't immediately re-write it.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (isClosed) return;
    clearTimeout(saveTimer.current);
    const snapshot = {
      visitId, clientId, repId, hasExpansion,
      product: product.trim() || `Expansion — ${clientName}`,
      productType, stage,
      valueInr: valueInr ? parseFloat(valueInr) : null,
      probabilityCode: probabilityCode || null,
      etaText: etaText || null,
      quoteRef: quoteRef || null,
      notes: notes || null,
      tsmUserId:        tsmMode === 'internal' && tsmUserId ? parseInt(tsmUserId, 10) : null,
      tsmExternal:      tsmMode === 'external' ? (tsmExternal.trim() || null) : null,
      tsmExternalEmail: tsmMode === 'external' ? (tsmExternalEmail.trim() || null) : null,
    };
    saveTimer.current = setTimeout(() => {
      saveExpansionOpportunity(snapshot)
        .then(res => setExpansionError(res.ok ? '' : res.error))
        .catch(() => setExpansionError('This could not be saved. Check the connection and try again.'));
    }, 900);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasExpansion, product, productType, stage, valueInr, probabilityCode, etaText, quoteRef, notes, tsmMode, tsmUserId, tsmExternal, tsmExternalEmail]);

  const toggleStyle = (active: boolean): CSSProperties => ({
    padding: '6px 16px', borderRadius: 6,
    border: `1px solid ${active ? 'var(--brand-blue)' : 'var(--line-strong)'}`,
    background: active ? 'var(--brand-blue)' : 'var(--bg-paper)',
    color: active ? '#fff' : 'var(--fg-2)',
    fontSize: 13, fontWeight: 500,
    cursor: isClosed ? 'default' : 'pointer',
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--fg)' }}>
          Any expansion plans or new installation opportunity?
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" disabled={isClosed} onClick={() => setHasExpansion(true)} style={toggleStyle(hasExpansion)}>Yes</button>
          <button type="button" disabled={isClosed} onClick={() => setHasExpansion(false)} style={toggleStyle(!hasExpansion)}>No</button>
        </div>
      </div>

      {expansionError && (
        <div style={{ margin: '0 0 10px', padding: '8px 12px', borderRadius: 6, fontSize: 12, lineHeight: 1.5,
                      background: 'var(--neg-soft)', border: '1px solid var(--neg)', color: 'var(--neg-strong)' }}>
          {expansionError}
        </div>
      )}

      {hasExpansion && (
        <div style={{ padding: 16, background: 'var(--bg-elev)', borderRadius: 8, border: '1px solid var(--accent-line)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: '8px 12px', background: 'var(--accent-soft)', borderRadius: 6, fontSize: 12, color: 'var(--brand-blue)', fontWeight: 500 }}>
            ⚡ An opportunity in <strong>{stage}</strong> stage is saved automatically as you fill this in.
            {existingOpp && (
              <span style={{ marginLeft: 8, color: 'var(--pos)' }}>· Saved (OPP-{String(existingOpp.id).padStart(4, '0')})</span>
            )}
          </div>

          <div>
            <label style={LBL}>Product / Description</label>
            <Input
              placeholder="e.g. PCP × 3 MX-80 · Spent Wash (leave blank for auto-title)"
              value={product}
              onChange={e => setProduct(e.target.value)}
              disabled={isClosed}
            />
            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>
              Leave blank to use: &quot;Expansion — {clientName}&quot;
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL}>Product Type</label>
              <select value={productType} onChange={e => setProductType(e.target.value)} disabled={isClosed} style={INP}>
                {PRODUCT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Stage</label>
              <select value={stage} onChange={e => setStage(e.target.value)} disabled={isClosed} style={INP}>
                {['Suspect', 'Prospect', 'Quoted', 'Negotiating'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL}>Value (₹)</label>
              <Input type="number" inputMode="numeric" step="1" min="0" placeholder="e.g. 2500000" value={valueInr} onChange={e => setValueInr(e.target.value)} disabled={isClosed} />
              <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>Full amount in rupees</div>
            </div>
            <div>
              <label style={LBL}>Probability</label>
              <select value={probabilityCode} onChange={e => setProbabilityCode(e.target.value)} disabled={isClosed} style={INP}>
                <option value="">—</option>
                {PROBABILITY_CODES.map(c => <option key={c.code} value={c.code}>{probabilityCodeLabel(c)}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL}>Expected Close</label>
              <MonthYearSelect value={etaText} onChange={setEtaText} disabled={isClosed} />
            </div>
            <div>
              <label style={LBL}>Quote Reference</label>
              <Input placeholder="e.g. Q-2024-018" value={quoteRef} onChange={e => setQuoteRef(e.target.value)} disabled={isClosed} />
            </div>
          </div>

          <div>
            <label style={LBL}>Notes</label>
            <Textarea placeholder="Key context, next steps…" value={notes} onChange={e => setNotes(e.target.value)} disabled={isClosed} rows={2} />
          </div>

          {/* Tag a TSM — emailed on report submission for follow-up (esp. EPC/OEM) */}
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <label style={LBL}>Tag a TSM for follow-up</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['none', 'internal', 'external'] as const).map(m => {
                const on = tsmMode === m;
                return (
                  <button key={m} type="button" disabled={isClosed} onClick={() => setTsmMode(m)}
                    style={{
                      flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 6, cursor: isClosed ? 'default' : 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--line-strong)'}`,
                      background: on ? 'var(--accent)' : 'var(--bg-paper)', color: on ? '#fff' : 'var(--fg-2)', fontWeight: on ? 600 : 400,
                    }}>
                    {m === 'none' ? 'No one' : m === 'internal' ? 'Portal TSM' : 'External'}
                  </button>
                );
              })}
            </div>
            {tsmMode === 'internal' && (
              <select value={tsmUserId} onChange={e => setTsmUserId(e.target.value)} disabled={isClosed} style={INP}>
                <option value="">— Select TSM —</option>
                {reps.map(r => <option key={r.id} value={r.id}>{r.name}{r.zone ? ` · ${r.zone}` : ''}</option>)}
              </select>
            )}
            {tsmMode === 'external' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Input placeholder="TSM name *" value={tsmExternal} onChange={e => setTsmExternal(e.target.value)} disabled={isClosed} />
                <Input type="email" placeholder="Email * — notified on submit" value={tsmExternalEmail} onChange={e => setTsmExternalEmail(e.target.value)} disabled={isClosed} />
              </div>
            )}
            {tsmMode !== 'none' && (
              <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 4 }}>
                The tagged TSM is emailed when this report is submitted.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Action Points sub-components ───────────────────────────────

const TASK_PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  High:   { bg: 'var(--neg-soft)',  text: 'var(--neg)'  },
  Medium: { bg: 'var(--warn-soft)', text: 'var(--warn)' },
  Low:    { bg: 'var(--pos-soft)',  text: 'var(--pos)'  },
};

function TaskRow({ task, isClosed, onComplete, onDelete }: {
  task: TaskItem;
  isClosed: boolean;
  onComplete: (id: number, status: 'open' | 'completed', title?: string, existingNote?: string | null) => void;
  onDelete: (id: number) => void;
}) {
  const isOverdue = !!task.due_date && task.status === 'open' && new Date(task.due_date) < new Date();
  const pc = TASK_PRIORITY_COLORS[task.priority ?? 'Medium'] ?? TASK_PRIORITY_COLORS.Medium;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0',
      borderBottom: '1px solid var(--line-2)',
      opacity: task.status === 'completed' ? 0.6 : 1,
    }}>
      {!isClosed && (
        <input
          type="checkbox"
          checked={task.status === 'completed'}
          onChange={() => onComplete(
            task.id, task.status === 'open' ? 'completed' : 'open', task.title, task.resolution_note ?? null)}
          style={{ marginTop: 3, flexShrink: 0 }}
        />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--fg)',
          textDecoration: task.status === 'completed' ? 'line-through' : 'none',
        }}>
          {task.title}
        </div>
        {task.description && (
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>{task.description}</div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: pc.bg, color: pc.text }}>
            {task.priority ?? 'Medium'}
          </span>
          {task.due_date && (
            <span style={{
              fontSize: 11, fontFamily: 'var(--font-mono)',
              color: isOverdue ? 'var(--neg)' : 'var(--fg-3)', fontWeight: isOverdue ? 600 : 400,
            }}>
              📅 {isOverdue ? 'Overdue · ' : ''}
              {new Date(task.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
            → {task.assigned_rep_name ?? task.assigned_to_external ?? 'Unassigned'}
          </span>
          {task.created_by === 'system' && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: 'var(--accent-soft)', color: 'var(--brand-blue)' }}>
              AUTO
            </span>
          )}
        </div>
      </div>

      {!isClosed && task.status !== 'completed' && (
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          aria-label="Delete action point"
          style={{ background: 'none', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0 }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  border: '1px solid var(--line-strong)', borderRadius: 6,
  fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)',
  color: 'var(--fg)', outline: 'none', boxSizing: 'border-box',
};
