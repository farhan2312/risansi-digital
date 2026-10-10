import type { CSSProperties, ReactNode } from 'react';
import { parseQuotationLink } from '@/lib/risansi-quotation-link';

// How a stored quotation_link is shown, everywhere it is shown.
//
// No 'use client' on purpose: it holds no state and no handlers, so it renders
// inside the server-rendered client page and pipeline table as happily as it
// does inside the Edit drawer. One component means the pipeline row, Client 360
// and the drawer can no longer disagree about what a value means — which they
// did, in three different ways, before this existed.
//
// The three things it fixes, all of them silent until you look at the data:
//   · a document name with no url is text, not an <a>. It used to be linked, and
//     because the name is not a url the browser resolved it against the current
//     page — 'For Panpat.pdf' on a client page went to /risansi/clients/For%20Panpat.pdf.
//   · a value holding two urls shows two links. It used to be one href with the
//     blank lines still in it, so the second quotation was unreachable.
//   · a legacy record says it is legacy, so nobody reads a SharePoint url on
//     someone's OneDrive as a document this portal holds.

export function QuotationLinkView({ value, compact, label }: {
  value: string | null | undefined;
  /** Table-cell sizing: one line, no wrapping, smaller type. */
  compact?: boolean;
  /** Text for the primary link. Defaults to something describing the kind. */
  label?: ReactNode;
}) {
  const q = parseQuotationLink(value);
  if (q.kind === 'none') return null;

  const size = compact ? 11 : 12.5;

  if (q.kind === 'upload') {
    return (
      <a href={q.appPath!} target="_blank" rel="noreferrer"
        style={{ ...LINK, fontSize: size }}>
        {label ?? 'Quotation'} ↗
      </a>
    );
  }

  // A name with no address. Shown, never linked — the whole point is that there
  // is nothing to open, and a link that 404s is worse than plain text because it
  // reads as though the document is one click away.
  if (q.kind === 'legacy-name') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: compact ? 'nowrap' : 'wrap' }}>
        <span
          title={`On record as “${q.label}”. No file was ever attached and no address was recorded, so there is nothing to open.`}
          style={{
            fontSize: size, color: 'var(--fg-2)',
            ...(compact ? { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}),
          }}>
          {q.label}
        </span>
        <Chip tone="muted">no file</Chip>
      </span>
    );
  }

  // One or more external urls.
  const many = q.urls.length > 1;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {q.urls.map((u, i) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer"
          title={q.label ? `${q.label} — ${u}` : u}
          style={{ ...LINK, fontSize: size }}>
          {many ? `Link ${i + 1}` : (label ?? 'Quotation')} ↗
        </a>
      ))}
      <Chip tone="legacy">legacy</Chip>
    </span>
  );
}

/**
 * The legacy badge on its own, for rows that render the link themselves.
 *
 * Client 360 hangs the quotation off the deal value and the stage table hangs it
 * off the quote reference, so neither can use the view above — but both still
 * have to say that a SharePoint url is not a document this portal holds. Without
 * it the only difference between the two is a title attribute, which a phone
 * never shows.
 */
export function LegacyMark({ count, noFile }: { count?: number; noFile?: boolean }) {
  const many = (count ?? 0) > 1;
  return (
    <span
      title={noFile
        ? 'A quotation is on record here, but no file was attached and no address was recorded.'
        : many
          ? `${count} legacy quotation links on this opportunity — open it to see them all`
          : 'Recorded before quotation uploads existed — opens SharePoint'}
      style={{
        ...CHIP, fontSize: 8.5, padding: '0 3px', opacity: 0.8,
        color: 'var(--warn-strong)', borderColor: 'var(--warn-strong)',
      }}>
      {noFile ? 'no file' : many ? `legacy ×${count}` : 'legacy'}
    </span>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone: 'legacy' | 'muted' }) {
  return (
    <span style={{
      ...CHIP,
      color: tone === 'legacy' ? 'var(--warn-strong)' : 'var(--fg-3)',
      borderColor: tone === 'legacy' ? 'var(--warn-strong)' : 'var(--line-strong)',
      opacity: tone === 'legacy' ? 0.85 : 1,
    }}>
      {children}
    </span>
  );
}

const LINK: CSSProperties = {
  color: 'var(--brand-blue)', textDecoration: 'none', fontWeight: 600,
};
const CHIP: CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
  border: '1px solid', borderRadius: 4, padding: '1px 4px', lineHeight: 1.5, whiteSpace: 'nowrap',
};
