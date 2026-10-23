'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import {
  CITY_COORDS, STATE_CENTERS, INTL_STATES, normaliseStateName, cityKey,
} from '@/lib/risansi-india-geo';

// Boundaries that show India as the Government of India depicts it. The file
// this replaced was GADM, clipped to the Line of Control: it stopped at
// 35.5°N, so Aksai Chin, Gilgit-Baltistan and Azad Kashmir were simply absent
// from the country. See public/india-states-goi.json's provenance note in
// lib/risansi-india-geo.ts.
const GEO_URL = '/india-states-goi.json';
/** The boundary file's own property for the state name. */
const GEO_NAME_PROP = 'name';

// The field map, rebuilt.
//
// ── What was wrong with the old one ─────────────────────────────
//
// Flat grey states and one 2.5px dot per client, each shifted by a jitter
// derived from its id. Three problems, and the first two are the same problem:
//
//   The states carried no information. The portal knows revenue, pipeline and
//   coverage per state and the map showed none of it, so the one thing a map is
//   for - "where is the business, and where is it not being covered" - had to
//   be answered by reading the table beside it.
//
//   Thirty clients in Pune drew thirty overlapping dots in a 0.4 degree box.
//   That is not thirty readable marks, it is one smudge, and the jitter made it
//   a smudge in the wrong place: the dots implied per-client precision over
//   coordinates that are really just the city centre.
//
//   Hardcoded #F4F7FC and white, so it stayed a white panel in dark mode.
//
// ── What it does now ────────────────────────────────────────────
//
// States are a choropleth over a metric the reader picks: clients, revenue,
// open pipeline, or coverage. Cities are ONE bubble per city, area proportional
// to the metric, split into a coverage ring so a big bubble that is mostly red
// reads as a big problem at a glance. Hovering either gives the figures behind
// it, and the right rail ranks the states so the map and the ranking cannot
// disagree - both are the same aggregate.
//
// Everything is tokens, so dark mode works.

export interface MapClient {
  id:              string;
  legal_name:      string;
  city:            string | null;
  state:           string | null;
  last_visit_date: string | null;
  tier:            string | null;
  rep_name:        string;
  industry:        string | null;
  lifetime_rev:    number;
  open_value:      number;
  open_opps:       number;
  visit_waiver:    string | null;
}

// ── Metrics ───────────────────────────────────────────────────

type MetricKey = 'clients' | 'revenue' | 'pipeline' | 'coverage';

interface Metric {
  key: MetricKey;
  label: string;
  hint: string;
  /** Rupees get formatted; counts and percentages do not. */
  money: boolean;
  /** Higher is better, so a pale state is a problem rather than an absence. */
  of: (a: Agg) => number;
  fmt: (n: number) => string;
}

const fmtInr = (n: number) => {
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1) + ' L';
  if (n > 0)    return '₹' + Math.round(n).toLocaleString('en-IN');
  return '—';
};
const fmtNum = (n: number) => (n > 0 ? n.toLocaleString('en-IN') : '—');

const METRICS: Metric[] = [
  { key: 'clients',  label: 'Clients',  money: false,
    hint: 'How many clients sit in each state.',
    of: a => a.n, fmt: fmtNum },
  { key: 'revenue',  label: 'Revenue',  money: true,
    hint: 'Lifetime invoiced revenue, summed over the state.',
    of: a => a.rev, fmt: fmtInr },
  { key: 'pipeline', label: 'Pipeline', money: true,
    hint: 'Open opportunity value: everything not yet Won, Lost or Dropped.',
    of: a => a.pipe, fmt: fmtInr },
  { key: 'coverage', label: 'Coverage', money: false,
    hint: 'Share of clients visited in the last 90 days. Clients marked as needing no visit are left out of both sides.',
    of: a => a.coveragePct, fmt: n => (n >= 0 ? n.toFixed(0) + '%' : '—') },
];

// ── Coverage ──────────────────────────────────────────────────

type Band = 'fresh' | 'ageing' | 'stale' | 'waived';

const BANDS: { key: Band; label: string; color: string }[] = [
  { key: 'fresh',  label: 'Visited ≤ 30 days', color: 'var(--pos)' },
  { key: 'ageing', label: '30–90 days',        color: 'var(--warn)' },
  { key: 'stale',  label: 'Overdue / never',        color: 'var(--neg)' },
  { key: 'waived', label: 'No visit required',      color: 'var(--fg-4)' },
];
const BAND_COLOR = Object.fromEntries(BANDS.map(b => [b.key, b.color])) as Record<Band, string>;

function bandOf(c: MapClient): Band {
  // A waiver wins over "overdue" but not over a real recent visit: the visit
  // happened, and painting it grey would hide good news.
  const d = c.last_visit_date ? daysSince(c.last_visit_date) : null;
  if (d !== null && d >= 0 && d <= 30) return 'fresh';
  if (c.visit_waiver) return 'waived';
  if (d === null || d < 0) return 'stale';
  if (d <= 90) return 'ageing';
  return 'stale';
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// ── Aggregation ───────────────────────────────────────────────

interface Agg {
  n: number;
  rev: number;
  pipe: number;
  opps: number;
  bands: Record<Band, number>;
  /** −1 when every client in the group is waived: there is no coverage to score. */
  coveragePct: number;
  topRep: string | null;
}

function aggregate(clients: MapClient[]): Agg {
  const bands: Record<Band, number> = { fresh: 0, ageing: 0, stale: 0, waived: 0 };
  const reps = new Map<string, number>();
  let rev = 0, pipe = 0, opps = 0;
  for (const c of clients) {
    bands[bandOf(c)]++;
    rev  += c.lifetime_rev || 0;
    pipe += c.open_value   || 0;
    opps += c.open_opps    || 0;
    if (c.rep_name) for (const r of c.rep_name.split(',').map(s => s.trim())) {
      if (r) reps.set(r, (reps.get(r) ?? 0) + 1);
    }
  }
  // The denominator excludes the waived, matching how coverage is counted
  // everywhere else: a state whose only unvisited clients are waived is
  // covered, not 50% covered.
  const scored = bands.fresh + bands.ageing + bands.stale;
  const topRep = [...reps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    n: clients.length, rev, pipe, opps, bands, topRep,
    coveragePct: scored > 0 ? (bands.fresh / scored) * 100 : -1,
  };
}

interface Group extends Agg {
  key: string;
  label: string;
  coords: [number, number];
  clients: MapClient[];
}

// ── Scales ────────────────────────────────────────────────────

/**
 * Bubble radius from the metric.
 *
 * Area, not radius, carries the value - a city with four times the revenue
 * gets four times the ink, not sixteen. sqrt on a 0..1 share of the largest
 * group, with a floor so a one-client city is still clickable.
 */
function radiusFor(v: number, max: number, zoom: number): number {
  if (max <= 0 || v <= 0) return 3 / Math.sqrt(zoom);
  const r = 3.5 + Math.sqrt(v / max) * 13;
  return r / Math.sqrt(zoom);
}

// Land is --bg-paper and up; the sea is --bg-sunk; the border is --fg-3.
//
// The first version ramped from 8% accent over --bg-paper on a --bg-elev sea,
// and painted no-data states --bg-sunk. In light mode that put an empty state
// at 1.09:1 against the water and the border at 1.39:1 — so most of the
// country was invisible and there was no outline to anchor it. The palette is
// built against measured contrast now:
//
//   border (--fg-3) vs sea   3.35:1 light, 6.99:1 dark
//   border vs palest land    4.12:1 light, 6.09:1 dark
//   darkest land vs sea      3.81:1 light, 4.46:1 dark
//
// A single-hue ramp has to cross the sea's luminance somewhere, so neither
// fill nor border can carry the silhouette alone. Between them one always
// does: pale states read by their outline, saturated ones by their fill.
const LAND_NO_DATA = 'var(--bg-paper)';

function stateFill(v: number, max: number, metric: Metric): string {
  if (metric.key === 'coverage') {
    // Coverage is a rate, not a total, so it gets a verdict ramp rather than
    // an intensity one. A dark state on the Revenue map is good news; a dark
    // state on a coverage map would be ambiguous.
    if (v < 0)   return LAND_NO_DATA;
    if (v >= 75) return 'color-mix(in oklab, var(--pos) 62%, var(--bg-paper))';
    if (v >= 50) return 'color-mix(in oklab, var(--pos) 34%, var(--bg-paper))';
    if (v >= 25) return 'color-mix(in oklab, var(--warn) 42%, var(--bg-paper))';
    return 'color-mix(in oklab, var(--neg) 38%, var(--bg-paper))';
  }
  if (max <= 0 || v <= 0) return LAND_NO_DATA;
  // sqrt again: a few states hold most of the business, and a linear ramp
  // leaves everything but Maharashtra and Gujarat looking empty.
  const t = Math.sqrt(v / max);
  const pct = Math.round(10 + t * 75);
  return `color-mix(in oklab, var(--accent) ${pct}%, var(--bg-paper))`;
}

// ── Component ─────────────────────────────────────────────────

interface Hover {
  title: string;
  sub: string | null;
  agg: Agg;
  x: number; y: number;
  names: string[];
}

const HEIGHT = 560;

export function IndiaMap({ clients }: { clients: MapClient[] }) {
  const [metricKey, setMetricKey] = useState<MetricKey>('clients');
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([82.5, 22]);
  const [hover, setHover] = useState<Hover | null>(null);
  const [activeState, setActiveState] = useState<string | null>(null);

  const metric = METRICS.find(m => m.key === metricKey)!;

  // ── Grouping ──
  // Both aggregates come from the same client list, so the choropleth, the
  // bubbles and the ranking cannot drift from one another.
  const { byState, cityGroups, stateMax, cityMax, plottedCount, intlCount, total } = useMemo(() => {
    const stateBuckets = new Map<string, MapClient[]>();
    const cityBuckets  = new Map<string, { label: string; coords: [number, number]; list: MapClient[] }>();
    let intl = 0, plotted = 0;

    for (const c of clients) {
      if (c.state && INTL_STATES.has(c.state)) { intl++; continue; }
      const st = normaliseStateName(c.state);
      if (st) {
        const cur = stateBuckets.get(st) ?? [];
        cur.push(c); stateBuckets.set(st, cur);
      }
      // A city we have coordinates for gets its own bubble; everything else
      // falls back to the state centre, labelled as such rather than
      // pretending to be a place.
      const ck = c.city ? cityKey(c.city) : null;
      const coords = ck ? CITY_COORDS[ck] : (st ? STATE_CENTERS[st] : undefined);
      if (!coords) continue;
      plotted++;
      const key = ck ?? `state:${st}`;
      const label = ck ?? (st ? st + ' (city not recorded)' : '');
      const b = cityBuckets.get(key) ?? { label, coords, list: [] };
      b.list.push(c); cityBuckets.set(key, b);
    }

    const stateAggs = new Map<string, Agg>();
    for (const [k, list] of stateBuckets) stateAggs.set(k, aggregate(list));

    const cities: Group[] = [...cityBuckets.entries()].map(([key, b]) => ({
      key, label: b.label, coords: b.coords, clients: b.list, ...aggregate(b.list),
    }));

    const sMax = Math.max(0, ...[...stateAggs.values()].map(a => metric.of(a)));
    const cMax = Math.max(0, ...cities.map(a => metric.of(a)));
    return {
      byState: stateAggs, cityGroups: cities,
      stateMax: sMax, cityMax: cMax,
      plottedCount: plotted, intlCount: intl, total: clients.length,
    };
  }, [clients, metric]);

  // Biggest first so the small bubbles land on top and stay hoverable.
  const drawOrder = useMemo(
    () => [...cityGroups].sort((a, b) => metric.of(b) - metric.of(a)),
    [cityGroups, metric],
  );

  const ranking = useMemo(
    () => [...byState.entries()]
      .map(([name, a]) => ({ name, a, v: metric.of(a) }))
      .filter(r => r.v > 0 || metric.key === 'coverage')
      .sort((a, b) => b.v - a.v)
      .slice(0, 12),
    [byState, metric],
  );

  const totals = useMemo(() => aggregate(clients.filter(c => !(c.state && INTL_STATES.has(c.state)))), [clients]);

  const showAt = (e: { clientX: number; clientY: number; target: EventTarget | null },
                  h: Omit<Hover, 'x' | 'y'>) => {
    const svg = (e.target as SVGElement | null)?.closest('svg');
    const rect = svg ? svg.getBoundingClientRect() : { left: 0, top: 0 } as DOMRect;
    setHover({ ...h, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const reset = () => { setZoom(1); setCenter([82.5, 22]); };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 232px', gap: 0,
                  border: '1px solid var(--line)', borderRadius: 'var(--radius)',
                  overflow: 'hidden', background: 'var(--bg-paper)' }}>
      <div>
        {/* ── Metric switcher + totals strip ── */}
        <div style={BAR}>
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg-sunk)', borderRadius: 7, padding: 2 }}>
            {METRICS.map(m => (
              <button key={m.key} type="button" title={m.hint}
                onClick={() => setMetricKey(m.key)}
                style={{ ...SEG, ...(m.key === metricKey ? SEG_ON : null) }}>
                {m.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <Stat label="Clients"  value={fmtNum(totals.n)} />
            <Stat label="Revenue"  value={fmtInr(totals.rev)} />
            <Stat label="Pipeline" value={fmtInr(totals.pipe)} sub={totals.opps + ' open'} />
            <Stat label="Coverage"
              value={totals.coveragePct >= 0 ? totals.coveragePct.toFixed(0) + '%' : '—'}
              color={totals.coveragePct >= 50 ? 'var(--pos)' : 'var(--warn-strong)'} />
          </div>
        </div>

        {/* The sea. --bg-sunk, not --bg-elev: the land ramp starts at
            --bg-paper, and bg-elev sits between the two, which is what made
            an empty state indistinguishable from the water. */}
        <div style={{ position: 'relative', background: 'var(--bg-sunk)' }}>
          <ComposableMap
            projection="geoMercator"
            projectionConfig={{ center: [82.5, 22], scale: 1020 }}
            style={{ width: '100%', height: HEIGHT, display: 'block' }}
          >
            <ZoomableGroup center={center} zoom={zoom} minZoom={0.9} maxZoom={10}
              onMoveEnd={({ coordinates, zoom: z }) => { setCenter(coordinates as [number, number]); setZoom(z); }}>

              <Geographies geography={GEO_URL}>
                {({ geographies }) => geographies.map(geo => {
                  const raw  = String(geo.properties?.[GEO_NAME_PROP] ?? '');
                  const name = normaliseStateName(raw) ?? raw;
                  const agg  = byState.get(name);
                  const v    = agg ? metric.of(agg) : (metric.key === 'coverage' ? -1 : 0);
                  const on   = activeState === name;
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={stateFill(v, stateMax, metric)}
                      stroke={on ? 'var(--accent)' : 'var(--fg-3)'}
                      strokeWidth={(on ? 1.8 : 0.6) / zoom}
                      onMouseEnter={e => {
                        setActiveState(name);
                        showAt(e as unknown as MouseEvent, {
                          title: name,
                          sub: agg ? null : 'No clients on record',
                          agg: agg ?? aggregate([]),
                          names: [],
                        });
                      }}
                      onMouseLeave={() => { setActiveState(null); setHover(null); }}
                      style={{
                        default: { outline: 'none' },
                        hover:   { outline: 'none', cursor: 'pointer' },
                        pressed: { outline: 'none' },
                      }}
                    />
                  );
                })}
              </Geographies>

              {/* ── City bubbles ── */}
              {drawOrder.map(g => {
                const v = metric.of(g);
                const r = radiusFor(metric.key === 'coverage' ? g.n : v,
                                    metric.key === 'coverage' ? Math.max(...drawOrder.map(x => x.n)) : cityMax,
                                    zoom);
                // The ring is the coverage split, so the colour of a bubble is
                // the state of the clients inside it rather than an average
                // nobody can act on.
                const ringW = Math.max(1.2, r * 0.42);
                let acc = 0;
                const circ = 2 * Math.PI * (r - ringW / 2);
                return (
                  <Marker key={g.key} coordinates={g.coords}
                    onMouseEnter={e => showAt(e as unknown as MouseEvent, {
                      title: g.label,
                      sub: g.n === 1 ? g.clients[0].legal_name : g.n + ' clients',
                      agg: g,
                      names: g.clients.slice(0, 6).map(c => c.legal_name),
                    })}
                    onMouseLeave={() => setHover(null)}>
                    <circle r={Math.max(r - ringW, 0.8)}
                      fill="var(--bg-paper)" fillOpacity={0.55} stroke="none" />
                    {BANDS.map(b => {
                      const share = g.bands[b.key] / Math.max(g.n, 1);
                      if (share <= 0) return null;
                      const dash = share * circ;
                      const off = -acc * circ;
                      acc += share;
                      return (
                        <circle key={b.key}
                          r={Math.max(r - ringW / 2, 0.6)}
                          fill="none" stroke={b.color} strokeWidth={ringW}
                          strokeDasharray={`${dash} ${circ - dash}`}
                          strokeDashoffset={off}
                          transform="rotate(-90)"
                          style={{ cursor: 'pointer' }} />
                      );
                    })}
                    {/* The count, once the bubble is big enough to hold it. */}
                    {r > 9 && (
                      <text textAnchor="middle" dy={r * 0.3} style={{ pointerEvents: 'none' }}
                        fontSize={r * 0.85} fontWeight={700} fill="var(--fg)">
                        {g.n}
                      </text>
                    )}
                  </Marker>
                );
              })}

              {/* State names, once there is room for them. */}
              {zoom >= 2.2 && [...byState.keys()].map(name => {
                const c = STATE_CENTERS[name];
                if (!c) return null;
                return (
                  <Marker key={'lbl-' + name} coordinates={c}>
                    <text textAnchor="middle" dy={-14 / zoom} style={{ pointerEvents: 'none' }}
                      fontSize={11 / zoom} fontWeight={600} fill="var(--fg-3)"
                      stroke="var(--bg-elev)" strokeWidth={3 / zoom} paintOrder="stroke">
                      {name}
                    </text>
                  </Marker>
                );
              })}
            </ZoomableGroup>
          </ComposableMap>

          {/* ── Zoom controls ── */}
          <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button type="button" onClick={() => setZoom(z => Math.min(z * 1.6, 10))} style={ZBTN} aria-label="Zoom in">+</button>
            <button type="button" onClick={() => setZoom(z => Math.max(z / 1.6, 0.9))} style={ZBTN} aria-label="Zoom out">&minus;</button>
            <button type="button" onClick={reset} style={{ ...ZBTN, fontSize: 9, letterSpacing: '0.04em' }} aria-label="Reset view">RESET</button>
          </div>

          {/* ── Legend ── */}
          <div style={CARD_BL}>
            <div style={LEG_T}>Bubble ring &middot; last visit</div>
            {BANDS.map(b => (
              <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--fg-2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: b.color, flexShrink: 0 }} />
                {b.label}
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
                  {totals.bands[b.key]}
                </span>
              </div>
            ))}
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--line)', fontSize: 9.5, color: 'var(--fg-3)', lineHeight: 1.55 }}>
              Bubble area = {metric.key === 'coverage' ? 'clients' : metric.label.toLowerCase()} &middot; state shade = {metric.label.toLowerCase()}
              <br />Scroll to zoom &middot; drag to pan
            </div>
          </div>

          {/* ── Choropleth scale ── */}
          <div style={CARD_BR}>
            <div style={LEG_T}>State shade &middot; {metric.label}</div>
            {metric.key === 'coverage' ? (
              <div style={{ display: 'flex', gap: 0 }}>
                {[['0–25%', 30, 'neg'], ['25–50%', 34, 'warn'], ['50–75%', 28, 'pos'], ['75%+', 55, 'pos']].map(([l, p, t]) => (
                  <div key={String(l)} style={{ textAlign: 'center' }}>
                    <div style={{ width: 38, height: 9, background: `color-mix(in oklab, var(--${t}) ${p}%, var(--bg-paper))` }} />
                    <div style={{ fontSize: 8.5, color: 'var(--fg-3)', marginTop: 2 }}>{l}</div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div style={{ height: 9, width: 152, borderRadius: 2, border: '1px solid var(--fg-3)', background:
                  'linear-gradient(to right, color-mix(in oklab, var(--accent) 10%, var(--bg-paper)), color-mix(in oklab, var(--accent) 85%, var(--bg-paper)))' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8.5, color: 'var(--fg-3)', marginTop: 2 }}>
                  <span>0</span><span>{metric.fmt(stateMax)}</span>
                </div>
              </>
            )}
          </div>

          {/* ── Hover card ── */}
          {hover && <HoverCard h={hover} metric={metric} />}
        </div>

        <div style={FOOT}>
          {plottedCount.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')} clients placed
          {' · '}{cityGroups.length} locations
          {intlCount > 0 && ` · ${intlCount} international, listed below`}
          {/* ODbL requires this credit wherever the boundary data is shown. */}
          <span style={{ marginLeft: 'auto', float: 'right', color: 'var(--fg-4)' }}>
            Boundaries{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer"
               style={{ color: 'var(--fg-4)' }}>
              &copy; OpenStreetMap contributors
            </a>
            {' '}(ODbL), Government of India depiction
          </span>
        </div>
      </div>

      {/* ── Ranking rail ── */}
      <div style={{ borderLeft: '1px solid var(--line)', background: 'var(--bg-paper)',
                    height: HEIGHT + 86, overflowY: 'auto' }}>
        <div style={{ ...LEG_T, padding: '10px 12px 8px', borderBottom: '1px solid var(--line)',
                      position: 'sticky', top: 0, background: 'var(--bg-elev)', margin: 0 }}>
          States by {metric.label}
        </div>
        {ranking.length === 0 && <div style={{ padding: 12, fontSize: 11, color: 'var(--fg-3)' }}>Nothing to rank.</div>}
        {ranking.map(r => {
          const share = metric.key === 'coverage'
            ? Math.max(r.v, 0)
            : (stateMax > 0 ? (r.v / stateMax) * 100 : 0);
          return (
            <div key={r.name}
              onMouseEnter={() => setActiveState(r.name)}
              onMouseLeave={() => setActiveState(null)}
              style={{ padding: '7px 12px', borderBottom: '1px solid var(--line)',
                       background: activeState === r.name ? 'var(--bg-sunk)' : 'transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11.5, color: 'var(--fg)', fontWeight: 500 }}>{r.name}</span>
                <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--fg)' }}>
                  {metric.fmt(r.v)}
                </span>
              </div>
              <div style={{ height: 3, marginTop: 4, background: 'var(--bg-sunk)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: Math.min(share, 100) + '%',
                              background: metric.key === 'coverage'
                                ? (r.v >= 50 ? 'var(--pos)' : 'var(--warn-strong)')
                                : 'var(--accent)' }} />
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--fg-3)', marginTop: 3 }}>
                {r.a.n} client{r.a.n === 1 ? '' : 's'}
                {r.a.topRep && ' · ' + r.a.topRep}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Hover card ────────────────────────────────────────────────

function HoverCard({ h, metric }: { h: Hover; metric: Metric }) {
  const a = h.agg;
  // Flipped when it would run off the right edge of a 1fr column; 300 is the
  // card's own width plus the offset.
  const flip = h.x > 520;
  return (
    <div style={{
      position: 'absolute',
      left: flip ? undefined : h.x + 16, right: flip ? 16 : undefined,
      top: Math.max(h.y - 10, 8),
      background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
      borderRadius: 8, padding: '9px 12px', minWidth: 196, maxWidth: 260,
      boxShadow: '0 6px 24px rgba(0,0,0,0.14)', pointerEvents: 'none', zIndex: 50,
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{h.title}</div>
      {h.sub && <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 1 }}>{h.sub}</div>}

      {a.n > 0 ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 10px', marginTop: 7,
                        fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: 'var(--fg-3)' }}>Clients</span>
            <span style={{ color: 'var(--fg)', textAlign: 'right' }}>{a.n}</span>
            <span style={{ color: 'var(--fg-3)' }}>Revenue</span>
            <span style={{ color: 'var(--fg)', textAlign: 'right' }}>{fmtInr(a.rev)}</span>
            <span style={{ color: 'var(--fg-3)' }}>Pipeline</span>
            <span style={{ color: 'var(--fg)', textAlign: 'right' }}>
              {fmtInr(a.pipe)}{a.opps > 0 && <span style={{ color: 'var(--fg-3)' }}> / {a.opps}</span>}
            </span>
            <span style={{ color: 'var(--fg-3)' }}>Covered</span>
            <span style={{ textAlign: 'right',
                           color: a.coveragePct < 0 ? 'var(--fg-3)'
                                : a.coveragePct >= 50 ? 'var(--pos)' : 'var(--warn-strong)' }}>
              {a.coveragePct >= 0 ? a.coveragePct.toFixed(0) + '%' : 'n/a'}
            </span>
          </div>

          {/* The coverage split, as the bar the ring is drawn from. */}
          <div style={{ display: 'flex', height: 4, marginTop: 7, borderRadius: 2, overflow: 'hidden', background: 'var(--bg-sunk)' }}>
            {BANDS.map(b => a.bands[b.key] > 0 && (
              <div key={b.key} style={{ width: (a.bands[b.key] / a.n) * 100 + '%', background: BAND_COLOR[b.key] }} />
            ))}
          </div>

          {h.names.length > 0 && (
            <div style={{ marginTop: 7, paddingTop: 6, borderTop: '1px solid var(--line)',
                          fontSize: 10, color: 'var(--fg-3)', lineHeight: 1.5 }}>
              {h.names.join(' · ')}
              {a.n > h.names.length && ` · +${a.n - h.names.length} more`}
            </div>
          )}
          {metric.key !== 'clients' && (
            <div style={{ marginTop: 5, fontSize: 9.5, color: 'var(--fg-4)' }}>{metric.hint}</div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 5 }}>Nothing on record here.</div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 700, color: color ?? 'var(--fg)', lineHeight: 1.2 }}>
        {value}
        {sub && <span style={{ fontSize: 9.5, fontWeight: 400, color: 'var(--fg-3)', marginLeft: 4 }}>{sub}</span>}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const BAR: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  padding: '8px 12px', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)',
};
const SEG: CSSProperties = {
  padding: '4px 11px', borderRadius: 5, border: 'none', background: 'transparent',
  fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', cursor: 'pointer', fontFamily: 'inherit',
};
const SEG_ON: CSSProperties = {
  background: 'var(--bg-paper)', color: 'var(--fg)',
  boxShadow: '0 1px 2px rgba(0,0,0,0.10)',
};
const ZBTN: CSSProperties = {
  width: 26, height: 26, borderRadius: 6, border: '1px solid var(--line-strong)',
  background: 'var(--bg-paper)', color: 'var(--fg-2)', cursor: 'pointer',
  fontSize: 14, lineHeight: 1, fontFamily: 'inherit', display: 'grid', placeItems: 'center',
  fontWeight: 600,
};
const CARD: CSSProperties = {
  position: 'absolute', background: 'var(--bg-paper)',
  border: '1px solid var(--line)', borderRadius: 7, padding: '7px 10px',
  display: 'flex', flexDirection: 'column', gap: 4,
  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
};
const CARD_BL: CSSProperties = { ...CARD, bottom: 10, left: 10, minWidth: 158 };
const CARD_BR: CSSProperties = { ...CARD, bottom: 10, right: 10 };
const LEG_T: CSSProperties = {
  fontSize: 9, fontWeight: 700, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2,
};
const FOOT: CSSProperties = {
  padding: '7px 12px', borderTop: '1px solid var(--line)', background: 'var(--bg-elev)',
  fontSize: 10.5, color: 'var(--fg-3)',
};
