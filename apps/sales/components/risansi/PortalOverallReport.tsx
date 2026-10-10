// The Overall tab wrapped for paper.
//
// Split from app/print/portal-overall/page.tsx so the layout can be rendered
// without a request, a session or a database — scripts/portal-overall-preview.mjs
// feeds it real data and writes an HTML file. A print layout is the one thing you
// cannot check by reading it.
import type { OverallData } from '@/lib/risansi-audit-overall';
import { AutoPrint } from '@/components/risansi/AutoPrint';
import { DocHeader } from '@/components/risansi/print-shared';
import { AuditOverall } from '@/components/risansi/AuditOverall';

// Landscape: the heatmap runs sixteen columns wide and the people table eleven.
//
// print-color-adjust is not optional here. Browsers drop background fills when
// printing by default, and every bar, every heat cell and every donut segment on
// this page IS a background fill — without it the PDF is a page of empty tracks.
export const OVERALL_PRINT_CSS = `
  @page { size: A4 landscape; margin: 9mm 8mm; }
  @media print {
    .no-print { display: none !important; }
    .overall-print, .overall-print * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    /* Wide panels scroll on screen; on paper there is nowhere to scroll to. */
    .overall-print [style*="overflow-x"] { overflow: visible !important; }
    /* globals.css puts a 1px border on everything with an inline border-radius,
       which on this page means every mini-bar, heat cell and donut swatch. Undo
       it and put the outline back on the panels, which are the only things that
       wanted one. */
    .overall-print [style*="border-radius"] { border: 0 !important; }
    .overall-print .ov-panel {
      border: 1px solid #E2E8F0 !important;
      break-inside: avoid; page-break-inside: avoid;
      margin-bottom: 10px;
    }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
  }
  /* The screen component reads every colour from these, so pinning them here
     prints the same page whether the operator is in light or dark mode. */
  .overall-print {
    color-scheme: light;
    --fg: #0F172A; --fg-2: #334155; --fg-3: #64748B; --fg-4: #94A3B8;
    --bg: #FFFFFF; --bg-paper: #FFFFFF; --bg-elev: #F8FAFC; --bg-sunk: #F1F5F9;
    --line: #E2E8F0; --line-2: #EEF2F7; --line-strong: #CBD5E1;
    --accent: #0A3D8F; --accent-soft: #EBF1FB; --accent-line: #CBD9EE;
    --title: #0A3D8F;
    --pos: #047857; --pos-soft: #ECFDF5;
    --neg: #B91C1C; --neg-soft: #FEF2F2;
    --warn: #B45309; --warn-soft: #FEF3C7;
    --radius: 8px;
    --font-mono: 'IBM Plex Mono', ui-monospace, 'Courier New', monospace;
    color: #0F172A;
  }
`;


export interface PortalOverallReportProps {
  d: OverallData;
  win: string; role: string; user: string;
  /** The filter set, spelled out for the header band. */
  filters: string;
  generated: string;
  generatedBy: string;
  /** Off in the offline preview, which has no print dialog to open. */
  autoPrint?: boolean;
}

export function PortalOverallReport({
  d, win, role, user, filters, generated, generatedBy, autoPrint = true,
}: PortalOverallReportProps) {
  return (
    <div className="overall-print" style={{ background: '#fff', minHeight: '100vh', padding: '14px 16px 30px' }}>
      <style dangerouslySetInnerHTML={{ __html: OVERALL_PRINT_CSS }} />
      {autoPrint && <AutoPrint label="Save as PDF" />}

      <div style={{ fontFamily: '"Helvetica Neue", Arial, system-ui, sans-serif' }}>
        <DocHeader
          kind="Portal Usage"
          title="How the portal is being used"
          subtitle={filters}
          meta={<>
            {d.from && <div style={{ fontWeight: 700, color: '#0F172A' }}>{d.from} to {d.to}</div>}
            <div style={{ marginTop: 6 }}>Generated {generated}</div>
            <div>by {generatedBy}</div>
          </>}
        />

        <AuditOverall d={d} win={win} role={role} user={user} people={[]} print />

        <div style={{ fontSize: 9.5, color: '#64748B', lineHeight: 1.6, marginTop: 12 }}>
          <strong style={{ color: '#334155' }}>How to read this.</strong>{' '}
          Active hours are measured, not inferred: the portal records seconds a page was
          actually in focus, so an hour here is an hour of use rather than a tab left open.
          Everything above covers {filters.toLowerCase()}, except the last panel, which is
          the position as it stands today regardless of the period. Admin and sysadmin
          figures are not comparable with a rep&apos;s — they are doing data administration
          rather than selling.
        </div>
      </div>
    </div>
  );
}
