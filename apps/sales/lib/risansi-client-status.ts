// Shared client-status vocabulary — one definition imported by the form, the
// server actions, the list filters, badges, and KPI queries.
//
// Prospective clients come in two sorts (segregated 2026-08):
//   • PROSPECTIVE_LEAD   — a raw lead; code is auto-generated LEAD_… .
//   • PROSPECTIVE_CLIENT — an enquiry arrived and we have their ERP client code.
// A prospective client becomes ACTIVE once they place their first order.
//
// The distinction is locked to the code type: a Prospective-Lead always carries a
// LEAD_ code; Prospective-Client and Active always carry a real (non-LEAD_) code.

export const CLIENT_STATUSES = [
  'PROSPECTIVE_LEAD', 'PROSPECTIVE_CLIENT', 'ACTIVE', 'INACTIVE', 'CLOSED', 'DUPLICATE',
] as const;
export type ClientStatus = typeof CLIENT_STATUSES[number];

export const PROSPECTIVE_STATUSES = ['PROSPECTIVE_LEAD', 'PROSPECTIVE_CLIENT'] as const;

export const CLIENT_STATUS_LABELS: Record<string, string> = {
  PROSPECTIVE_LEAD:   'Prospective-Lead',
  PROSPECTIVE_CLIENT: 'Prospective-Client',
  ACTIVE:             'Active',
  INACTIVE:           'Inactive',
  CLOSED:             'Closed',
  DUPLICATE:          'Duplicate',
  // Legacy values, in case a stray un-migrated row is ever displayed.
  PROSPECTIVE:        'Prospective',
  Prospective:        'Prospective',
};

// Badge colours: [text, background]. Chosen so the text meets WCAG AA on its tint.
export const CLIENT_STATUS_COLORS: Record<string, [string, string]> = {
  PROSPECTIVE_LEAD:   ['#7C3AED', '#F3E8FF'],   // violet — raw lead
  PROSPECTIVE_CLIENT: ['#B45309', '#FEF3C7'],   // amber  — enquiry in hand
  ACTIVE:             ['#0B7A55', '#D1FAE5'],   // green
  INACTIVE:           ['#6B7280', '#F3F4F6'],   // grey
  CLOSED:             ['#B91C1C', '#FEE2E2'],   // red
  DUPLICATE:          ['#6B7280', '#F3F4F6'],   // grey
  PROSPECTIVE:        ['#B45309', '#FEF3C7'],
};

/** True for any prospective status, including the legacy single value. */
export function isProspectiveStatus(s?: string | null): boolean {
  return s === 'PROSPECTIVE_LEAD' || s === 'PROSPECTIVE_CLIENT'
      || s === 'PROSPECTIVE' || s === 'Prospective';
}

/** Human label for a status value, with a safe passthrough for unknowns. */
export function clientStatusLabel(s?: string | null): string {
  if (!s) return '—';
  return CLIENT_STATUS_LABELS[s] ?? CLIENT_STATUS_LABELS[s.toUpperCase()] ?? s;
}

/** Badge colours for a status value, defaulting to neutral grey. */
export function clientStatusColors(s?: string | null): [string, string] {
  if (!s) return ['#6B7280', '#F3F4F6'];
  return CLIENT_STATUS_COLORS[s] ?? CLIENT_STATUS_COLORS[s.toUpperCase()] ?? ['#6B7280', '#F3F4F6'];
}

/** A LEAD_ code marks a raw lead; real ERP codes are everything else. */
export function isLeadCode(code?: string | null): boolean {
  return typeof code === 'string' && code.toUpperCase().startsWith('LEAD_');
}

/** Map a status to a StatusDot kind (segregates lead vs prospective-client). */
export function statusDotKind(
  s?: string | null,
): 'active' | 'inactive' | 'prospect' | 'lead' | 'client' | 'closed' {
  switch (s) {
    case 'ACTIVE':             return 'active';
    case 'INACTIVE':           return 'inactive';
    case 'PROSPECTIVE_LEAD':   return 'lead';
    case 'PROSPECTIVE_CLIENT': return 'client';
    case 'CLOSED':             return 'closed';
    case 'PROSPECTIVE':
    case 'Prospective':        return 'prospect';
    default:                   return 'inactive';
  }
}

/** {value,label} options for a client-status multiselect filter. */
export const CLIENT_STATUS_FILTER_OPTIONS: { value: string; label: string }[] =
  CLIENT_STATUSES.map(s => ({ value: s, label: CLIENT_STATUS_LABELS[s] ?? s }));

/**
 * Statuses a client may hold given its code type (coupling enforcement):
 *   • LEAD_ code   → Prospective-Lead or Duplicate.
 *   • real code    → Prospective-Client, Active, Inactive, Closed, Duplicate.
 * Converting a lead into a client (LEAD_ → real code) goes through the dedicated
 * Convert action, not a plain status edit.
 */
export function allowedStatusesForCode(code?: string | null): ClientStatus[] {
  return isLeadCode(code)
    ? ['PROSPECTIVE_LEAD', 'DUPLICATE']
    : ['PROSPECTIVE_CLIENT', 'ACTIVE', 'INACTIVE', 'CLOSED', 'DUPLICATE'];
}
