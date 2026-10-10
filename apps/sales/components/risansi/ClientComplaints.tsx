import Link from 'next/link';
import type { CSSProperties } from 'react';
import { STATUS_TONE, SEVERITY_TONE, isOpenStatus, type Severity } from '@/lib/risansi-complaint-flow';
import type { ComplaintListRow } from '@/lib/risansi-complaint-rows';

// The complaints panel on Client 360: every complaint on the client, open
// first, with where it is and who is holding it, each a link into the
// complaint itself. Server-rendered from the same loader as the Complaints
// page, so the two never disagree.
//
// Two things it used to get wrong, both now read the way the rest of the module
// reads them:
//
//   What the complaint is about. It showed `complaint_type` (Technical /
//   Non-technical) beside `defect_category`. The form stopped asking for both;
//   Complaint Category and its sub-category replaced them. The old pair still
//   shows on the complaints that carry them and nowhere else, because a
//   historical row with no category would otherwise lose its only description.
//
//   Overdue. It read the `overdue` column SQL computed from
//   `target_completion_date`, a field only page 5 asks for — so a complaint
//   nobody had touched had no target and was never late, which is the
//   34-open-but-1-overdue figure the review queried. The rule is `overdueFor`
//   now: age since raised against the days the severity allows, thresholds read
//   from `complaint_sla_thresholds`. The loader calls it once per row and this
//   panel reads the verdict rather than grading again, so the panel and the
//   Complaints list cannot end up disagreeing about which complaints are late.

/**
 * A list row, plus the two columns the loader is in the middle of adding.
 * Declared optional so this panel compiles either way and falls back to the old
 * answer at runtime when a row does not carry the new one.
 */
export type ClientComplaintRow = ComplaintListRow & {
  complaint_category?: string | null;
  complaint_subcategory?: string | null;
  complaint_type?: string | null;
  defect_category?: string | null;
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const fmtDays = (d: number) => (d < 1 ? '<1d' : `${Math.round(d)}d`);

/** What this complaint is about, in the words the record actually holds. */
function subject(c: ClientComplaintRow): string | null {
  if (c.complaint_category) {
    return c.complaint_subcategory ? `${c.complaint_category} · ${c.complaint_subcategory}` : c.complaint_category;
  }
  // Historical: the category was never answered, so the old pair is all there is.
  if (c.complaint_type) return c.defect_category ? `${c.complaint_type} · ${c.defect_category}` : c.complaint_type;
  return c.defect_category ?? null;
}

export function ClientComplaints({ complaints, clientId }: { complaints: ClientComplaintRow[]; clientId: number }) {
  const open = complaints.filter(c => isOpenStatus(c.status));
  const overdue = open.filter(c => c.overdue).length;
  const noAction = open.filter(c => c.overdue_kind === 'no-action').length;
  const critical = open.filter(c => c.severity === 'High').length;
  // Two senses of "this client's complaint": the ones about their pumps, and —
  // when they are an OEM — the ones they raised on somebody else's. Counted
  // apart, because a header reading "14 complaints" would otherwise suggest
  // fourteen failures on their own plant.
  const raised = complaints.filter(c => c.oem_client_id === clientId && c.client_id !== clientId).length;
  return (
    <div data-tabgroup="activity" style={PANEL}>
      <div style={PANEL_H}>
        <span style={PANEL_TITLE}>Complaints</span>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
          {complaints.length - raised} about them{raised ? ` · ${raised} raised by them` : ''}{open.length ? ` · ${open.length} open` : ''}
          {overdue ? ` · ${overdue} overdue${noAction ? ` (${noAction} untouched)` : ''}` : ''}
          {critical ? ` · ${critical} high criticality` : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {complaints.length > 0 && <Link href={`/risansi/complaints?q=${encodeURIComponent(complaints[0].client_code ?? '')}`} style={{ fontSize: 11.5, color: 'var(--accent)', textDecoration: 'none', alignSelf: 'center' }}>All in module →</Link>}
          <Link href={`/risansi/complaints/new?client=${clientId}`} style={RAISE_BTN}>⚠ Raise</Link>
        </div>
      </div>
      {complaints.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>No complaints for this client.</div>
      ) : (
        <div>
          {complaints.map((c, i) => {
            const isOpen = isOpenStatus(c.status);
            const legacy = c.schema_version < 2;
            // Came through this client as the OEM, about somebody else's pump.
            const byThem = c.oem_client_id === clientId && c.client_id !== clientId;
            const head = subject(c);
            return (
              <Link key={c.id} href={`/risansi/complaints/${c.id}`} className="c360-cmp-row"
                style={{ ...ROW, borderBottom: i < complaints.length - 1 ? '1px solid var(--line)' : 'none', opacity: isOpen ? 1 : 0.7 }}>
                <span className="c360-cmp-no" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-3)', flexShrink: 0, width: 92 }}>{c.complaint_no}</span>
                <span className="c360-cmp-text" style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {head ? <b style={{ fontWeight: 600 }}>{head} — </b> : null}{c.details}
                  </span>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--fg-3)', marginTop: 2 }}>
                    {byThem && <b style={{ color: 'var(--accent)', fontWeight: 600 }}>they raised this on {c.client_name ?? 'another client'}’s pump · </b>}
                    raised {day(c.complaint_date ?? c.created_at)}
                    {isOpen && !legacy && <> · with <b style={{ color: 'var(--fg-2)', fontWeight: 600 }}>{c.holder_name ?? c.holder_department ?? 'Complaint Team'}</b> for <b style={{ color: c.days_in_status > 7 ? 'var(--neg)' : 'var(--fg-2)', fontWeight: 600 }}>{fmtDays(c.days_in_status)}</b></>}
                    {!isOpen && <> · {c.status.toLowerCase()} after {fmtDays(c.age_days)}</>}
                    {/* The threshold is named, not just the verdict. "Overdue"
                        on its own invites an argument about what the deadline
                        was, and the deadline is now a figure Admin can change. */}
                    {c.overdue && (
                      <span style={{ color: 'var(--neg)', fontWeight: 700 }}>
                        {' '}· overdue
                        {c.overdue_days != null && c.overdue_threshold != null ? ` — ${c.overdue_days}d of ${c.overdue_threshold}d` : ''}
                        {c.overdue_kind === 'no-action' ? ', no action yet' : ''}
                      </span>
                    )}
                    {legacy && <span style={{ color: 'var(--fg-4)' }}> · legacy</span>}
                  </span>
                </span>
                {c.severity && <span style={{ ...PILL, background: SEVERITY_TONE[c.severity as Severity] }}>{c.severity}</span>}
                <span style={{ ...PILL, background: STATUS_TONE[c.status] ?? 'var(--fg-3)' }}>{c.status}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500 };
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', textDecoration: 'none', color: 'inherit', boxSizing: 'border-box' };
const PILL: CSSProperties = { padding: '2px 7px', borderRadius: 10, fontSize: 9.5, fontWeight: 700, color: 'var(--toggle-sel-fg)', whiteSpace: 'nowrap', flexShrink: 0 };
const RAISE_BTN: CSSProperties = { padding: '5px 11px', fontSize: 12, fontWeight: 600, background: 'var(--bg-paper)', color: 'var(--neg)', border: '1px solid var(--neg-soft)', borderRadius: 6, textDecoration: 'none' };
