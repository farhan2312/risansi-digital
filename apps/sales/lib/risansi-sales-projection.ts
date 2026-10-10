// Expected closures, rep by rep, month by month and quarter by quarter.
//
// The forecast question: of the pipeline that is still open, how much is each
// rep expecting to close and when. It reads opportunities.eta_text, which the
// Quoted form asks for as a month ("Sep 2026").
//
// READ THE COVERAGE FIGURE BEFORE READING THE TABLE. Only a small share of the
// open pipeline carries an expected-close month at all — the rest cannot be
// placed in any period and lands in "No date". A projection that quietly dropped
// those would show a fraction of the pipeline and be read as the whole forecast,
// so every row carries its undated value beside its dated one and the section
// states the coverage in words.
//
// Nothing here infers a date. Deriving one from the quote date and an average
// cycle would fill the table, and every figure in it would be invented.
import type { Pool } from 'pg';
import { LIVE_CLIENT } from '@/lib/risansi-opportunity-scope';
import { creditedRepSql } from '@/lib/risansi-attribution';
import { probabilityPctSql, hasProbabilitySql } from '@/lib/risansi-probability-codes';

/** Open = still live. Dropped is dead and has no place in a forecast. */
// Open, and on a client that still exists: an archived client's quotes are not
// expected to close (lib/risansi-opportunity-scope).
const OPEN = `o.stage NOT IN ('Won','Lost','Dropped') AND ${LIVE_CLIENT('o')}`;

/** The value of an opportunity, in rupees, by the same rule the rest of the app
 *  uses: the quoted offer where there is one, the estimate otherwise. */
const VALUE = `COALESCE(o.offer_value_inr, o.value_cr * 10000000, 0)`;
// The odds come from the probability code, never from the numeric column: that
// column carried stage defaults nobody entered, so weighting on it inflated the
// forecast with guesses. A quote with no code is unrated and weighs nothing.
const PROB_PCT = probabilityPctSql('o');
const HAS_PROB = hasProbabilitySql('o');

// eta_text is free-form varchar. Mapping the month name explicitly rather than
// with to_date, which raises on a month name it does not recognise and would
// take the whole section down over one badly typed row.
const ETA_MONTH = `CASE lower(left(btrim(o.eta_text), 3))
  WHEN 'jan' THEN 1 WHEN 'feb' THEN 2  WHEN 'mar' THEN 3  WHEN 'apr' THEN 4
  WHEN 'may' THEN 5 WHEN 'jun' THEN 6  WHEN 'jul' THEN 7  WHEN 'aug' THEN 8
  WHEN 'sep' THEN 9 WHEN 'oct' THEN 10 WHEN 'nov' THEN 11 WHEN 'dec' THEN 12
  END`;
const ETA_YEAR = `NULLIF(regexp_replace(o.eta_text, '\\D', '', 'g'), '')::int`;

export interface ProjectionCell {
  /** 'YYYY-MM' for a month, 'overdue', 'later', or 'none'. */
  bucket: string;
  gross: number;
  /** Gross × probability, summed only where a probability is recorded. */
  weighted: number;
  /** How much of `gross` had a probability to weight by. */
  weightedBase: number;
  count: number;
}

export interface ProjectionRep {
  repId: number;
  name: string;
  cells: ProjectionCell[];
  /** Every open opportunity of theirs, dated or not. */
  totalGross: number;
  totalCount: number;
}

export interface Projection {
  /** FY start year, e.g. 2026 for FY 26-27. */
  fyStart: number;
  /** The twelve 'YYYY-MM' keys of the fiscal year, April first. */
  months: string[];
  reps: ProjectionRep[];
  coverage: {
    openGross: number; openCount: number;
    datedGross: number; datedCount: number;
    /** Dated share of open value, 0-1. Null when there is no open pipeline. */
    share: number | null;
    /** Open value whose expected month has already passed. */
    overdueGross: number;
    /** How much of the open value carries a probability to weight by. */
    withProbGross: number;
  };
}

/** The narrowing a reader may ask for on the projection tab. Every key is optional. */
export interface ProjectionFilters {
  rep?: number | null;           // one rep, within the visible set
  prodType?: string[];
  industry?: string[];
  ctype?: string[];
  stage?: string[];              // Quoted / Negotiating / On Hold / Suspect / Prospect
  prob?: string[];               // probability codes
  market?: string[];
  minValue?: number | null;      // rupees
}

export const PROJECTION_FILTER_KEYS = ['prep', 'pptype', 'pind', 'pctype', 'pstage', 'pprob', 'pmarket', 'pmin'] as const;

/** Read the projection filters off the page's search params. */
export function parseProjectionFilters(sp: Record<string, string | string[] | undefined>): ProjectionFilters {
  const list = (k: string) => { const v = sp[k]; const arr = Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []; return arr.map(x => x.trim()).filter(Boolean); };
  const rep = typeof sp.prep === 'string' && /^\d+$/.test(sp.prep) ? Number(sp.prep) : null;
  const min = typeof sp.pmin === 'string' && /^\d+(\.\d+)?$/.test(sp.pmin) ? Number(sp.pmin) : null;
  return { rep, prodType: list('pptype'), industry: list('pind'), ctype: list('pctype'), stage: list('pstage'), prob: list('pprob'), market: list('pmarket'), minValue: min };
}

/** Distinct values on the open pipeline the viewer may see, to fill the filter dropdowns. */
export async function loadProjectionOptions(pool: Pool, repIds: number[] | null): Promise<{
  reps: { id: number; name: string }[]; prodTypes: string[]; industries: string[]; ctypes: string[]; stages: string[]; probs: string[]; markets: string[];
}> {
  if (repIds !== null && repIds.length === 0) return { reps: [], prodTypes: [], industries: [], ctypes: [], stages: [], probs: [], markets: [] };
  // Whose forecast a row belongs to is the client's owner, not o.rep_id — the
  // attribution rule of 1 Oct 2026 (lib/risansi-attribution.ts). Everything
  // here is open work, so credited_rep_id is always NULL and this resolves to
  // the live owner; it goes through the helper anyway so the forecast cannot
  // drift from the board it is forecasting.
  const repFilter = repIds === null ? '' : ` AND ${creditedRepSql()} = ANY($1::int[])`;
  const params = repIds === null ? [] : [repIds];
  const q = async (expr: string) => (await pool.query<{ v: string }>(
    `SELECT DISTINCT ${expr} AS v FROM opportunities o JOIN clients c ON c.id = o.client_id WHERE ${OPEN}${repFilter} AND ${expr} IS NOT NULL AND ${expr} <> '' ORDER BY 1`, params)).rows.map(r => r.v);
  const [reps, prodTypes, industries, ctypes, stages, probs, markets] = await Promise.all([
    pool.query<{ id: number; name: string }>(
      `SELECT DISTINCT u.id, u.name FROM opportunities o
         JOIN clients c ON c.id = o.client_id
         JOIN users u ON u.id = ${creditedRepSql()}
        WHERE ${OPEN}${repFilter} ORDER BY u.name`, params).then(r => r.rows),
    q('o.product_type'), q('c.industry'), q('c.client_type'), q('o.stage'), q('o.probability_code'), q('o.market'),
  ]);
  return { reps, prodTypes, industries, ctypes, stages, probs, markets };
}

/**
 * @param repIds  Visible reps. `null` means every rep — pass the same list the
 *                Executive Review's own selector was built from, so this section
 *                can never show a rep the viewer cannot otherwise see.
 * @param f       Further narrowing from the projection tab's filters; a rep
 *                chosen there must still be within `repIds`.
 */
export async function loadProjection(
  pool: Pool, fyStart: number, repIds: number[] | null, f: ProjectionFilters = {},
): Promise<Projection> {
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;                 // April .. March
    const y = fyStart + (m >= 4 ? 0 : 1);
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }

  if (repIds !== null && repIds.length === 0) {
    return {
      fyStart, months, reps: [],
      coverage: { openGross: 0, openCount: 0, datedGross: 0, datedCount: 0, share: null, overdueGross: 0, withProbGross: 0 },
    };
  }
  // The visibility list first, then the reader's own filters, all as
  // parameters. A rep picked on the tab outside the visible set yields nothing.
  const conds: string[] = [];
  const params: (number | string | number[] | string[])[] = [];
  const add = (sql: string, v: number | string | number[] | string[]) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)); };
  if (repIds !== null) add(`${creditedRepSql()} = ANY(?::int[])`, repIds);
  if (f.rep != null) add(`${creditedRepSql()} = ?`, f.rep);
  if (f.prodType?.length) add('o.product_type = ANY(?::text[])', f.prodType);
  if (f.stage?.length)    add('o.stage = ANY(?::text[])', f.stage);
  if (f.prob?.length)     add('o.probability_code = ANY(?::text[])', f.prob);
  if (f.market?.length)   add('o.market = ANY(?::text[])', f.market);
  if (f.industry?.length) add('o.client_id IN (SELECT id FROM clients WHERE industry = ANY(?::text[]))', f.industry);
  if (f.ctype?.length)    add('o.client_id IN (SELECT id FROM clients WHERE client_type = ANY(?::text[]))', f.ctype);
  if (f.minValue != null && f.minValue > 0) add(`${VALUE} >= ?`, f.minValue);
  const repFilter = conds.length ? ` AND ${conds.join(' AND ')}` : '';

  // One row per rep per bucket. The bucket is worked out in SQL so a rep with no
  // opportunity in a month simply has no row, rather than the query returning a
  // dense grid of zeroes. An opportunity with no rep (its client has no owner;
  // see migration 0073) is an "Unassigned" row with rep id 0, last in the list,
  // rather than being dropped from the forecast by an inner join — it is still
  // money somebody expects. It never matches a rep-scoped view.
  const bucket = `
    CASE
      WHEN ${ETA_MONTH} IS NULL OR ${ETA_YEAR} IS NULL THEN 'none'
      WHEN make_date(${ETA_YEAR}, ${ETA_MONTH}, 1) < date_trunc('month', CURRENT_DATE) THEN 'overdue'
      WHEN make_date(${ETA_YEAR}, ${ETA_MONTH}, 1) > make_date(${fyStart + 1}, 3, 1) THEN 'later'
      WHEN make_date(${ETA_YEAR}, ${ETA_MONTH}, 1) < make_date(${fyStart}, 4, 1) THEN 'overdue'
      ELSE to_char(make_date(${ETA_YEAR}, ${ETA_MONTH}, 1), 'YYYY-MM')
    END`;

  const { rows } = await pool.query<{
    rep_id: number; name: string; bucket: string;
    gross: string; weighted: string; weighted_base: string; n: string;
  }>(`
    SELECT COALESCE(${creditedRepSql()}, 0) AS rep_id, COALESCE(u.name, 'Unassigned') AS name, ${bucket} AS bucket,
           COALESCE(sum(${VALUE}), 0)::text AS gross,
           COALESCE(sum(${VALUE} * ${PROB_PCT} / 100.0)
                      FILTER (WHERE ${HAS_PROB}), 0)::text AS weighted,
           COALESCE(sum(${VALUE}) FILTER (WHERE ${HAS_PROB}), 0)::text AS weighted_base,
           count(*)::text AS n
      FROM opportunities o
      JOIN clients c ON c.id = o.client_id
      LEFT JOIN users u ON u.id = ${creditedRepSql()}
     WHERE ${OPEN}${repFilter}
     GROUP BY ${creditedRepSql()}, u.name, ${bucket}
     ORDER BY (${creditedRepSql()} IS NULL), u.name`, params);

  const byRep = new Map<number, ProjectionRep>();
  for (const r of rows) {
    let rep = byRep.get(r.rep_id);
    if (!rep) {
      rep = { repId: r.rep_id, name: r.name, cells: [], totalGross: 0, totalCount: 0 };
      byRep.set(r.rep_id, rep);
    }
    const cell: ProjectionCell = {
      bucket: r.bucket,
      gross: Number(r.gross), weighted: Number(r.weighted),
      weightedBase: Number(r.weighted_base), count: Number(r.n),
    };
    rep.cells.push(cell);
    rep.totalGross += cell.gross;
    rep.totalCount += cell.count;
  }

  const reps = [...byRep.values()].sort((a, b) => b.totalGross - a.totalGross);

  // Coverage, over the same population the table is built from. Computed here
  // rather than from the cells so it is a statement about the query, not a
  // restatement of the grid.
  const { rows: [c] } = await pool.query<Record<string, string>>(`
    SELECT COALESCE(sum(${VALUE}), 0)::text AS open_gross,
           count(*)::text AS open_count,
           COALESCE(sum(${VALUE}) FILTER (WHERE ${ETA_MONTH} IS NOT NULL AND ${ETA_YEAR} IS NOT NULL), 0)::text AS dated_gross,
           count(*) FILTER (WHERE ${ETA_MONTH} IS NOT NULL AND ${ETA_YEAR} IS NOT NULL)::text AS dated_count,
           COALESCE(sum(${VALUE}) FILTER (
             WHERE ${ETA_MONTH} IS NOT NULL AND ${ETA_YEAR} IS NOT NULL
               AND make_date(${ETA_YEAR}, ${ETA_MONTH}, 1) < date_trunc('month', CURRENT_DATE)), 0)::text AS overdue_gross,
           COALESCE(sum(${VALUE}) FILTER (WHERE ${HAS_PROB}), 0)::text AS with_prob_gross
      FROM opportunities o WHERE ${OPEN}${repFilter}`, params);

  const openGross = Number(c?.open_gross ?? 0);
  const datedGross = Number(c?.dated_gross ?? 0);

  return {
    fyStart, months, reps,
    coverage: {
      openGross, openCount: Number(c?.open_count ?? 0),
      datedGross, datedCount: Number(c?.dated_count ?? 0),
      share: openGross > 0 ? datedGross / openGross : null,
      overdueGross: Number(c?.overdue_gross ?? 0),
      withProbGross: Number(c?.with_prob_gross ?? 0),
    },
  };
}

/** The four fiscal quarters, as the month keys each contains. */
export function quartersOf(months: string[]): { label: string; months: string[] }[] {
  return [0, 1, 2, 3].map(i => ({
    label: `Q${i + 1}`,
    months: months.slice(i * 3, i * 3 + 3),
  }));
}
