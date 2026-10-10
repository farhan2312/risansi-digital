'use client';

import { useState, type CSSProperties } from 'react';

// Rows come straight from the page's aggregate query. Counts arrive as strings
// (COUNT → bigint), flags as 0/1 — the component coerces defensively.
export type VisitReportRow = Record<string, any>;

// A KPI tile that doubles as a one-click list filter.
type FacetDef = { key: string; label: string; color?: string; pred: (v: VisitReportRow) => boolean };

const BRAND = 'var(--title)';   // #0A3D8F in light, brightened in dark

function num(v: unknown): number {
  const n = parseInt(String(v ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
}
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 't';
}
// Explicit false (not null/undefined) — e.g. a GPS check that ran and failed.
function isFalse(v: unknown): boolean {
  return v === false || v === 0 || v === '0' || v === 'f';
}

export function VisitReportsTab({ visits, filterActive = false }: { visits: VisitReportRow[]; filterActive?: boolean }) {
  const [facet, setFacet] = useState('');   // active KPI-tile filter (key)

  // KPI tiles double as one-click filters over the current (already server-filtered)
  // set; clicking narrows the list to that facet. Single-select — clicking the active
  // tile, or "Total Reports", clears it. Search / purpose / rep / date live in the
  // shared filter bar above the tabs (server-side), so `visits` arrives pre-filtered.
  const FACETS: FacetDef[] = [
    { key: 'expansion',  label: 'Expansion Leads',     color: 'var(--pos)',  pred: v => truthy(v.has_expansion) },
    { key: 'opps',       label: 'New Opportunities',   color: 'var(--pos)',  pred: v => num(v.auto_opp_count) > 0 },
    { key: 'complaints', label: 'Complaints',          color: 'var(--neg)',  pred: v => truthy(v.has_complaints) },
    { key: 'followup',   label: 'Open Follow-ups',     color: 'var(--warn)', pred: v => truthy(v.follow_up_required) },
    { key: 'competitor', label: 'Competitor Activity', color: 'var(--purple)', pred: v => truthy(v.competitor_activity_observed) },
    { key: 'equipment',  label: 'With Equipment',      color: BRAND,         pred: v => num(v.ril_equip_count) + num(v.competitor_equip_count) > 0 },
    { key: 'gps',        label: 'GPS Flagged',         color: 'var(--warn)', pred: v => isFalse(v.gps_within_radius) },
  ];
  const activeFacet = FACETS.find(f => f.key === facet) ?? null;

  const filtered = activeFacet ? visits.filter(v => activeFacet.pred(v)) : visits;
  const totalVisits = visits.length;

  if (totalVisits === 0) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--fg-3)' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 4 }}>
          {filterActive ? 'No reports match the filters' : 'No submitted visit reports yet'}
        </div>
        <div style={{ fontSize: 13 }}>
          {filterActive ? 'Adjust or clear the filters above.' : 'Reports appear here once a rep submits a completed visit form'}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* KPI tiles — click to filter the list below */}
      <style>{`.vr-facet:not(.vr-facet--on):hover{border-color:var(--line-strong)}`}</style>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <FacetTile label="Total Reports" value={totalVisits} active={facet === ''} onClick={() => setFacet('')} />
        {FACETS.map(f => (
          <FacetTile
            key={f.key}
            label={f.label}
            color={f.color}
            value={visits.filter(f.pred).length}
            active={facet === f.key}
            onClick={() => setFacet(cur => (cur === f.key ? '' : f.key))}
          />
        ))}
      </div>

      {/* Count — search / purpose / rep / date filtering happens in the shared bar above. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
        {facet ? `${filtered.length} of ${totalVisits}` : `${totalVisits} report${totalVisits !== 1 ? 's' : ''}`}
      </div>

      {/* List */}
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
            No reports match the selected tile
          </div>
        ) : (
          filtered.map(v => <VisitReportRowItem key={String(v.id)} visit={v} />)
        )}
      </div>
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────

function VisitReportRowItem({ visit }: { visit: VisitReportRow }) {
  const [expanded, setExpanded] = useState(false);

  const ril   = num(visit.ril_equip_count);
  const comp  = num(visit.competitor_equip_count);
  const autoOpps = num(visit.auto_opp_count);

  return (
    <div>
      {/* Collapsed summary */}
      <div
        onClick={() => setExpanded(x => !x)}
        style={{
          display: 'grid',
          gridTemplateColumns: '140px 1fr 130px auto auto',
          gap: 12, padding: '12px 16px',
          borderBottom: '1px solid var(--line)',
          cursor: 'pointer',
          background: expanded ? 'var(--bg-elev)' : 'var(--bg-paper)',
          alignItems: 'center',
        }}
      >
        {/* Col 1 — date + rep */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: BRAND }}>
            {fmtDate(visit.visit_date)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>{visit.rep_name}</div>
        </div>

        {/* Col 2 — client + purpose/summary */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <a
              href={`/risansi/clients/${visit.client_id}`}
              onClick={e => e.stopPropagation()}
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              {visit.client_name}
            </a>
            {visit.client_code && (
              <span style={{ marginLeft: 6, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
                {visit.client_code}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {visit.purpose ?? 'Visit'}
            {visit.summary && ` · ${String(visit.summary).slice(0, 60)}${String(visit.summary).length > 60 ? '…' : ''}`}
          </div>
        </div>

        {/* Col 3 — flags */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {truthy(visit.has_expansion)                && <span style={flag('#0E9F6E')}>⚡ Expansion</span>}
          {truthy(visit.has_complaints)               && <span style={flag('#E02424')}>🔴 Complaint</span>}
          {truthy(visit.follow_up_required)           && <span style={flag('#D97706')}>🟡 Follow-up</span>}
          {truthy(visit.competitor_activity_observed) && <span style={flag('#7C3AED')}>🔵 Competitor</span>}
        </div>

        {/* Col 4 — equipment / opps */}
        <div className="vr-equip" style={{ fontSize: 11, color: 'var(--fg-3)', textAlign: 'right', whiteSpace: 'nowrap' }}
          title={ril + comp > 0 ? `${ril + comp} pump${ril + comp === 1 ? '' : 's'} seen on this visit: ${ril} Risansi, ${comp} competitor` : undefined}>
          {ril + comp > 0 && (
            <div>
              <span style={{ fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>{ril + comp}</span> pump{ril + comp === 1 ? '' : 's'}
              <span style={{ color: 'var(--fg-4)' }}> · </span>{ril} RIL<span style={{ color: 'var(--fg-4)' }}> · </span>{comp} competitor
            </div>
          )}
          {autoOpps > 0 && <div style={{ color: BRAND }}>🎯 {autoOpps} opp</div>}
        </div>

        {/* Col 5 — status + chevron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
            background: visit.submitted_at ? 'var(--pos-soft)' : 'var(--bg-sunk)',
            color: visit.submitted_at ? 'var(--pos-strong)' : 'var(--fg-3)', whiteSpace: 'nowrap',
          }}>
            {visit.submitted_at ? 'Submitted' : String(visit.status ?? '')}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--fg-3)" strokeWidth="2"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: '200ms', flexShrink: 0 }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '16px 20px', background: 'var(--bg-elev)', borderBottom: '2px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <a
              href={`/risansi/visits/${visit.id}`}
              style={{ fontSize: 12, color: BRAND, border: '1px solid rgba(26,92,184,0.3)', borderRadius: 5, padding: '4px 10px', textDecoration: 'none', background: 'var(--accent-soft)' }}
            >
              Open Full Report →
            </a>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>

            {/* Col 1 — visit details */}
            <div>
              <SectionTitle>Visit Details</SectionTitle>
              <DetailRow label="Purpose"          value={visit.purpose} />
              <DetailRow label="Outcome"          value={visit.outcome} />
              <DetailRow label="Industry Format"  value={visit.industry_format} />
              <DetailRow label="Performance"      value={visit.performance_feedback} />
              <DetailRow label="Mgmt Intervention" value={visit.mgmt_intervention} />
              <DetailRow label="PCP Competitor"   value={visit.pcp_competitor} />
              {visit.check_in_time  && <DetailRow label="Check-in"  value={fmtTime(visit.check_in_time)} />}
              {visit.check_out_time && <DetailRow label="Check-out" value={fmtTime(visit.check_out_time)} />}
              {visit.gps_within_radius !== null && visit.gps_within_radius !== undefined && (
                <DetailRow label="GPS" value={truthy(visit.gps_within_radius) ? '✓ Within radius' : '⚠ Outside radius'} />
              )}
              {truthy(visit.manual_checkin) && <DetailRow label="Check-in Type" value="Manual check-in" />}
            </div>

            {/* Col 2 — commercial intel */}
            <div>
              <SectionTitle>Commercial Intel</SectionTitle>
              <BooleanRow label="Expansion Plans"     value={truthy(visit.has_expansion)}              trueColor="var(--pos)" />
              <BooleanRow label="Complaints"          value={truthy(visit.has_complaints)}             trueColor="var(--neg)" />
              <BooleanRow label="Pending Offers"      value={truthy(visit.has_pending_offers)}         trueColor="var(--warn)" />
              <BooleanRow label="Outstanding Issues"  value={truthy(visit.has_outstanding_issues)}     trueColor="var(--warn)" />
              <BooleanRow label="Follow-up Required"  value={truthy(visit.follow_up_required)}         trueColor="var(--warn)" />
              {truthy(visit.follow_up_required) && visit.follow_up_text && (
                <SubNote>
                  {visit.follow_up_text}
                  {visit.follow_up_due_date && <span style={{ color: 'var(--neg)' }}> · Due {fmtDate(visit.follow_up_due_date)}</span>}
                </SubNote>
              )}
              <BooleanRow label="Competitor Activity" value={truthy(visit.competitor_activity_observed)} trueColor="var(--neg)" />
              {visit.competitors_observed && <SubNote>{visit.competitors_observed}</SubNote>}
              <BooleanRow label="Sample/Gift Given"   value={truthy(visit.sample_or_gift_given)}        trueColor="var(--warn)" />
              {truthy(visit.sample_or_gift_given) && visit.sample_gift_detail && (
                <SubNote>
                  {visit.sample_gift_detail}
                  {visit.sample_gift_value && <span> · ₹{Number(visit.sample_gift_value).toLocaleString('en-IN')}</span>}
                </SubNote>
              )}
            </div>

            {/* Col 3 — equipment + items + summary */}
            <div>
              <SectionTitle>Equipment &amp; Items</SectionTitle>
              {ril  > 0 && <DetailRow label="RIL Pumps"        value={`${ril} pump${ril === 1 ? '' : 's'}`} />}
              {comp > 0 && <DetailRow label="Competitor Pumps" value={`${comp} pump${comp === 1 ? '' : 's'}`} />}
              {num(visit.displacement_opp_count) > 0 && (
                <DetailRow label="Displacement Opps" value={`${num(visit.displacement_opp_count)} flagged`} valueColor={BRAND} />
              )}
              {autoOpps > 0 && <DetailRow label="Auto-created Opps" value={`${autoOpps} opportunities`} valueColor="var(--pos)" />}
              {num(visit.task_count) > 0 && <DetailRow label="Tasks Created" value={`${num(visit.task_count)} tasks`} />}
              {visit.next_visit_recommendation && <DetailRow label="Next Visit" value={fmtDate(visit.next_visit_recommendation)} />}

              {visit.summary && (
                <>
                  <SectionTitle style={{ marginTop: 12 }}>Summary</SectionTitle>
                  <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5, background: 'var(--bg-paper)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line)' }}>
                    {visit.summary}
                  </div>
                </>
              )}
              {visit.action_points && (
                <>
                  <SectionTitle style={{ marginTop: 10 }}>Action Points</SectionTitle>
                  <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5 }}>{visit.action_points}</div>
                </>
              )}
              <DetailRow label="Open Remarks" value={visit.open_remarks} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function fmtDate(d: unknown): string {
  if (!d) return '—';
  const dt = new Date(String(d));
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(d: unknown): string {
  if (!d) return '—';
  const dt = new Date(String(d));
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function FacetTile({ label, value, color, active, onClick }: {
  label: string; value: number; color?: string; active: boolean; onClick: () => void;
}) {
  // Selection is shown with a coloured border + inset ring only — no accent-tinted
  // background or accent-coloured label, both of which drop the small label / number
  // below AA contrast on the mid-tone accents (warn, pos). The number keeps its
  // facet colour (large 20px text); the label stays neutral.
  const accent = color ?? 'var(--brand-blue)';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={active ? 'vr-facet vr-facet--on' : 'vr-facet'}
      title={active ? 'Click to clear this filter' : `Show only: ${label}`}
      style={{
        textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
        background: 'var(--bg-paper)',
        border: `1px solid ${active ? accent : 'var(--line)'}`,
        boxShadow: active ? `inset 0 0 0 1px ${accent}` : 'none',
        borderRadius: 'var(--radius)', padding: '8px 14px', minWidth: 118,
        transition: 'border-color 120ms, box-shadow 120ms',
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, lineHeight: 1.2, marginTop: 2, color: color ?? 'var(--fg)' }}>
        {value.toLocaleString('en-IN')}
      </div>
    </button>
  );
}

function SectionTitle({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, color: BRAND, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, ...style }}>
      {children}
    </div>
  );
}

function DetailRow({ label, value, valueColor }: { label: string; value: unknown; valueColor?: string }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5, gap: 8 }}>
      <span style={{ color: 'var(--fg-3)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: valueColor ?? 'var(--fg)', fontWeight: 500, textAlign: 'right' }}>{String(value)}</span>
    </div>
  );
}

function BooleanRow({ label, value, trueColor }: { label: string; value: boolean; trueColor: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: value ? trueColor : 'var(--line-strong)', flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 600, color: value ? trueColor : 'var(--fg-3)', marginLeft: 'auto' }}>{value ? 'YES' : 'NO'}</span>
    </div>
  );
}

function SubNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 14, marginBottom: 6, fontStyle: 'italic', lineHeight: 1.4 }}>
      {children}
    </div>
  );
}

function flag(color: string): CSSProperties {
  return {
    fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 4,
    background: color + '18', color, border: `1px solid ${color}40`, whiteSpace: 'nowrap',
  };
}
