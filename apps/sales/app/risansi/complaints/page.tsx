import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Topbar } from '@/components/risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';
import { loadComplaintRows, loadHolderDwells, parseComplaintFilters, parseComplaintSort, FILTER_KEYS } from '@/lib/risansi-complaint-rows';
import { summariseComplaints, clientBars } from '@/lib/risansi-complaint-stats';
import { ComplaintStats } from '@/components/risansi/complaints/ComplaintStats';
import { ComplaintFilterBar, type FilterOptions } from '@/components/risansi/complaints/ComplaintFilterBar';
import { ComplaintTable } from '@/components/risansi/complaints/ComplaintTable';

export const dynamic = 'force-dynamic';

// Complaints: the numbers, then the list.
//
// The URL is the state. Filters, a clicked bar on the dashboard and the export
// all read the same search params through parseComplaintFilters, so what is on
// screen is what comes down as a sheet. Rows are the viewer's — a rep sees
// their clients' complaints, the module's departments see all.

export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const me = await getCurrentUser();
  const filters = parseComplaintFilters(sp);
  const sort = parseComplaintSort(sp);
  const value: Record<string, string | undefined> = {};
  for (const k of FILTER_KEYS) value[k] = filters[k];

  const [rows, dwells, allRows, subcatCatalogue] = await Promise.all([
    loadComplaintRows(me, { filters, sort }),
    loadHolderDwells(me),
    // The unfiltered set, for the filter options — so a value is still offered after another filter hides it.
    Object.keys(filters).length ? loadComplaintRows(me) : null,
    // The sub-category catalogue, by the category it belongs to. The filter
    // used to build this list from the complaints themselves, which meant
    // Supply Related offered Short and Wrong and not Excess or Drawing
    // Mismatch — nobody had raised one yet. A filter that can only name what
    // already exists cannot answer "have we had any of these", which is half
    // of what a filter is for.
    risansiPool.query<{ parent_value: string; value: string }>(
      `SELECT parent_value, value FROM complaint_lookups
        WHERE kind = 'complaint_subcategory' AND is_active AND parent_value IS NOT NULL
        ORDER BY parent_value, sort_order, value`).then(r => r.rows).catch(() => []),
  ]);
  const base = allRows ?? rows;
  const s = summariseComplaints(rows, dwells.filter(d => rows.some(r => r.id === d.complaint_id)));

  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  const people = (pairs: [number | null, string | null][]) => {
    const m = new Map<number, string>();
    for (const [id, name] of pairs) if (id != null && name) m.set(id, name);
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  };
  // The lookup tables say what MAY be chosen; these say what is actually on a
  // complaint. A dropdown built from the lookups would offer five categories
  // where four are in use and show an empty table for the fifth.
  const options: FilterOptions = {
    categories: uniq(base.map(r => r.complaint_category)),
    // Narrowed by the chosen Category, because a sub-category belongs to one:
    // offering all of them made "Supply Related · Wrong material despatched"
    // selectable together and return nothing. Still built from the UNFILTERED
    // set otherwise, like every list here — Category is the only filter that
    // is allowed to narrow it, because it is the only one it depends on.
    // The chosen category's catalogue, plus anything in use that the
    // catalogue does not know about — 'Wrong Supply' under Client Related is
    // a real complaint recorded before the lists were tidied, and dropping it
    // would make those rows unreachable.
    subcategories: (() => {
      const inUse = uniq(
        (filters.cat ? base.filter(r => r.complaint_category === filters.cat) : base)
          .map(r => r.complaint_subcategory),
      );
      const catalogue = filters.cat
        ? subcatCatalogue.filter(x => x.parent_value === filters.cat).map(x => x.value)
        : subcatCatalogue.map(x => x.value);
      // Catalogue order first — it is the order the lists were written in —
      // then anything in use it never mentioned.
      return [...catalogue, ...inUse.filter(v => !catalogue.includes(v))];
    })(),
    // Only the historical rows the 2 Oct mapping could not read onto a new
    // category. A row with both is reachable through Category instead, so
    // offering its old wording as well would be two routes to the same rows.
    legacyCategories: uniq(base.filter(r => !r.complaint_category).map(r => r.defect_category)),
    responsibles: uniq(base.map(r => r.responsible_department)),
    rootCauses: uniq(base.map(r => r.root_cause_category)),
    rootCauseSubs: uniq(base.map(r => r.root_cause_sub)),
    // Part type / name / MOC come from complaint_parts where page 2 has filled
    // it in, and from the old single-part columns on the historical rows.
    partTypes: uniq([...base.map(r => r.part_type), ...base.flatMap(r => r.parts.map(p => p.part_type))]),
    partNames: uniq([...base.map(r => r.part_name), ...base.flatMap(r => r.parts.map(p => p.part_name))]),
    mocs: uniq(base.flatMap(r => r.parts.map(p => p.moc))),
    industries: uniq(base.map(r => r.industry)),
    clientTypes: uniq(base.map(r => r.client_type)),
    actions: uniq(base.map(r => r.action_category)),
    modelVersions: uniq(base.map(r => r.model_version)),
    modelSeries: uniq(base.map(r => r.model_series)),
    reps: people(base.map(r => [r.rep_user_id, r.rep_name])),
    holders: people(base.map(r => [r.holder_user_id, r.holder_name])),
    // Same order as the by-client chart — most complaints first — so the
    // dropdown and the bars read as one thing.
    clients: clientBars(base).map(c => ({
      id: c.key, name: c.code ? `${c.label} (${c.code})` : c.label,
    })),
  };

  const sortParam = sort ? `${sort.key}_${sort.dir}` : undefined;
  const urlFor = (path: string, patch: Record<string, string | undefined>) => {
    const next: Record<string, string | undefined> = { ...value, sort: sortParam, ...patch };
    const usp = new URLSearchParams();
    for (const [k, x] of Object.entries(next)) if (x) usp.set(k, x);
    const q = usp.toString();
    return q ? `${path}?${q}` : path;
  };
  const href = (key: string, v: string) => urlFor('/risansi/complaints', { [key]: value[key] === v ? undefined : v });
  const exportHref = urlFor('/api/risansi/complaints/export', {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Complaints']} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Complaints</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              {rows.length} shown · {s.open} open · {s.overdue} overdue ({s.overdueNoAction} with no action){s.severeOpen ? ` · ${s.severeOpen} severe` : ''}{Object.keys(filters).length ? ` · ${Object.keys(filters).length} filter${Object.keys(filters).length === 1 ? '' : 's'} on` : ''}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <a href={exportHref} style={GHOST} title="The table below, as it is filtered, as a sheet">⤓ Export this table</a>
            <Link href="/risansi/complaints/new" style={PRIMARY}>⚠ Raise a complaint</Link>
          </div>
        </div>

        {/* Filters first, then the numbers they produced. Every tile and bar below
            is summarised from `rows`, which is already the filtered set — but with
            the controls sitting underneath them the dashboard read as a fixed
            header that ignored the filters. Order is the whole fix here. */}
        <ComplaintFilterBar value={{ ...value, sort: sortParam }} options={options} basePath="/risansi/complaints" />

        <ComplaintStats s={s} href={href} sel={value} />

        <ComplaintTable rows={rows} />
      </div>
    </div>
  );
}

const PRIMARY: CSSProperties = { display: 'inline-block', padding: '8px 14px', fontSize: 12.5, fontWeight: 600, borderRadius: 6, background: 'var(--neg-fill)', color: 'var(--on-accent)', textDecoration: 'none' };
const GHOST: CSSProperties = { display: 'inline-block', padding: '8px 14px', fontSize: 12.5, fontWeight: 600, borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)', textDecoration: 'none' };
