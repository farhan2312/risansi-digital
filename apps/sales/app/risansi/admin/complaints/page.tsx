import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { DEPARTMENTS, getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { SEVERITY_LABEL, type Severity } from '@/lib/risansi-complaint-flow';
import {
  LOOKUP_KINDS, kindLabel, parentKindOf, PROVISIONAL_ASSIGNMENTS,
  loadComplaintLookupRows, loadActionAssignments, loadKrishnaCandidates,
  loadSlaThresholds, loadSlaFacts,
} from '@/lib/risansi-complaint-admin';
import { AccessDenied } from '../_components/AccessDenied';
import { LookupEditor, type LookupKindOption } from './LookupEditor';
import { ActionAssignmentEditor } from './ActionAssignmentEditor';
import { SlaThresholdEditor } from './SlaThresholdEditor';

export const dynamic = 'force-dynamic';

// The three things about the complaint module that have to be changeable
// without a developer:
//
//   1. the dropdown lists        — the + Add On the requirement asks for six times
//   2. the action assignment map — which Action Taken lands on whose desk
//   3. the overdue thresholds    — the days each severity gets
//
// All three were constants in code or values in a migration, which meant a
// release every time the Complaint Team learned something. They are tables now,
// and this is the screen over them.
//
// Admin and sysadmin, matching the gate the rest of /risansi/admin uses: the
// layout redirects anybody below admin, and this page refuses as well so a
// direct hit on the route cannot render a half page if the layout ever changes.

export default async function ComplaintAdminPage() {
  const me = await getCurrentUser();
  if (!hasRole(me.role, 'admin')) {
    return <AccessDenied crumbs={['Admin', 'Complaint Settings']} />;
  }

  const [lookupRows, assignments, krishnaCandidates, users, thresholds] = await Promise.all([
    loadComplaintLookupRows(),
    loadActionAssignments(),
    loadKrishnaCandidates(),
    risansiPool.query<{ id: number; name: string; role: string }>(
      `SELECT id, name, role FROM users WHERE is_active ORDER BY name`).then(r => r.rows),
    loadSlaThresholds(),
  ]);
  const slaFacts = await loadSlaFacts(thresholds);

  // The kinds, in the order the form meets them, each with the parent list it
  // cascades under. Parents come from the lookup table itself rather than from
  // the values already used, so a category with nothing beneath it still shows
  // up as a place to add something — Client Related being exactly that.
  const kinds: LookupKindOption[] = Object.entries(LOOKUP_KINDS).map(([kind, meta]) => {
    const parentKind = parentKindOf(kind);
    const mine = lookupRows.filter(r => r.kind === kind);
    return {
      kind,
      label: meta.label,
      note: meta.note,
      retired: Boolean(meta.retired),
      parentKind,
      parentLabel: parentKind ? kindLabel(parentKind) : null,
      parents: parentKind
        ? lookupRows.filter(r => r.kind === parentKind && r.is_active).map(r => r.value)
        : [],
      active: mine.filter(r => r.is_active).length,
      total: mine.length,
    };
  });

  const slaRows = slaFacts.map(f => ({
    severity: f.severity,
    days: f.days,
    label: SEVERITY_LABEL[f.severity as Severity],
    open: f.open,
  }));

  const teamAdded = lookupRows.filter(r => r.is_user_added).length;
  const unmapped = assignments.filter(a => !a.mapped && a.active).length;
  const provisional = assignments.filter(a => a.action in PROVISIONAL_ASSIGNMENTS && a.assignee_kind !== 'user').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Admin', 'Complaint Settings']} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 48px', background: 'var(--bg)' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Complaint Settings
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3, maxWidth: 760, lineHeight: 1.55 }}>
            The three parts of the complaint module the Complaint Team owns: the lists the form offers,
            who an action hands the work to, and how long a complaint has before it is late. Changes take
            effect on the next page load — none of this needs a release.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10, fontSize: 11.5, color: 'var(--fg-3)' }}>
            <span><b style={{ color: 'var(--fg-2)' }}>{lookupRows.length}</b> values across {kinds.length} lists</span>
            <span><b style={{ color: 'var(--fg-2)' }}>{teamAdded}</b> added by the team</span>
            {provisional > 0 && <span style={{ color: 'var(--warn-strong)' }}>⚠ <b>{provisional}</b> provisional assignment{provisional === 1 ? '' : 's'}</span>}
            {unmapped > 0 && <span style={{ color: 'var(--neg)' }}>⚠ <b>{unmapped}</b> action{unmapped === 1 ? '' : 's'} assigned to nobody</span>}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1180 }}>
          <LookupEditor kinds={kinds} rows={lookupRows} />
          <ActionAssignmentEditor
            rows={assignments}
            users={users}
            departments={[...DEPARTMENTS]}
            provisional={PROVISIONAL_ASSIGNMENTS}
            krishnaCandidates={krishnaCandidates} />
          <SlaThresholdEditor rows={slaRows} />
        </div>
      </div>
    </div>
  );
}
