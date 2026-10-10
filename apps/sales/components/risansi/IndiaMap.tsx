'use client';

import { useState } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';

const GEO_URL = '/india-states.json';

export interface MapClient {
  id:              string;
  legal_name:      string;
  city:            string | null;
  state:           string | null;
  last_visit_date: string | null;
  tier:            string | null;
  rep_name:        string;
}

// ── State center coordinates [lng, lat] ───────────────────────

const STATE_CENTERS: Record<string, [number, number]> = {
  'Andhra Pradesh':     [79.7, 15.9],
  'Assam':              [92.9, 26.2],
  'Bihar':              [85.3, 25.1],
  'Chhattisgarh':       [81.9, 21.3],
  'Delhi':              [77.2, 28.6],
  'Goa':                [74.1, 15.3],
  'Gujarat':            [71.2, 22.3],
  'Haryana':            [76.1, 29.1],
  'Himachal Pradesh':   [77.2, 31.1],
  'Jammu And Kashmir':  [75.3, 33.7],
  'Jammu and Kashmir':  [75.3, 33.7],
  'Jharkhand':          [85.3, 23.6],
  'Karnataka':          [75.7, 15.3],
  'Kerala':             [76.3, 10.8],
  'Madhya Pradesh':     [78.7, 23.5],
  'Maharashtra':        [75.7, 19.7],
  'Manipur':            [93.9, 24.7],
  'Meghalaya':          [91.4, 25.5],
  'Mizoram':            [92.7, 23.2],
  'Nagaland':           [94.6, 26.1],
  'Odisha':             [85.1, 20.9],
  'Orissa':             [85.1, 20.9],
  'Puducherry':         [79.8, 11.9],
  'Punjab':             [75.3, 31.1],
  'Rajasthan':          [74.2, 27.0],
  'Sikkim':             [88.5, 27.5],
  'Tamil Nadu':         [78.7, 11.1],
  'Telangana':          [79.1, 18.1],
  'Tripura':            [91.9, 23.9],
  'Uttar Pradesh':      [80.9, 26.8],
  'Uttarakhand':        [79.0, 30.1],
  'Uttaranchal':        [79.0, 30.1],
  'West Bengal':        [88.4, 22.9],
};

// ── City center coordinates [lng, lat] ────────────────────────

const CITY_COORDS: Record<string, [number, number]> = {
  'Pune':              [73.86, 18.52],
  'Mumbai':            [72.88, 19.08],
  'Kolhapur':          [74.24, 16.70],
  'Solapur':           [75.91, 17.69],
  'Nashik':            [73.79, 20.00],
  'Nagpur':            [79.09, 21.15],
  'Aurangabad':        [75.34, 19.88],
  'Sambhajinagar':     [75.34, 19.88],
  'Bengaluru':         [77.59, 12.97],
  'Bangalore':         [77.59, 12.97],
  'Mysuru':            [76.64, 12.30],
  'Belagavi':          [74.50, 15.85],
  'Hubli':             [75.12, 15.36],
  'Ahmedabad':         [72.59, 23.03],
  'Surat':             [72.83, 21.17],
  'Vadodara':          [73.19, 22.31],
  'Rajkot':            [70.80, 22.30],
  'Chennai':           [80.28, 13.08],
  'Coimbatore':        [76.96, 11.02],
  'Madurai':           [78.12, 9.92],
  'Hyderabad':         [78.49, 17.39],
  'Kanpur':            [80.35, 26.45],
  'Lucknow':           [80.95, 26.85],
  'Noida':             [77.39, 28.54],
  'Ghaziabad':         [77.42, 28.67],
  'Meerut':            [77.71, 28.98],
  'Agra':              [78.02, 27.18],
  'Varanasi':          [83.00, 25.32],
  'Kolkata':           [88.37, 22.57],
  'Patna':             [85.14, 25.60],
  'Jaipur':            [75.79, 26.91],
  'Indore':            [75.86, 22.72],
  'Bhopal':            [77.41, 23.26],
  'New Delhi':         [77.21, 28.61],
  'Delhi':             [77.21, 28.61],
  'Chandigarh':        [76.78, 30.73],
  'Ludhiana':          [75.86, 30.90],
  'Amritsar':          [74.87, 31.64],
  'Panipat':           [76.97, 29.39],
  'Gurugram':          [77.03, 28.46],
  'Faridabad':         [77.31, 28.41],
  'Haridwar':          [78.17, 29.95],
  'Dehradun':          [78.03, 30.32],
  'Kashipur':          [78.96, 29.21],
  'Ranchi':            [85.33, 23.35],
  'Dhanbad':           [86.43, 23.79],
  'Raipur':            [81.63, 21.25],
  'Visakhapatnam':     [83.30, 17.69],
  'Guntur':            [80.44, 16.30],
  'Bhubaneswar':       [85.82, 20.30],
  'Guwahati':          [91.74, 26.14],
  'Thiruvananthapuram': [76.95, 8.52],
  'Kochi':             [76.27, 9.93],
  'Thrissur':          [76.22, 10.53],
};

// ── Helpers ────────────────────────────────────────────────────

const INTL_STATES = new Set([
  'UAE', 'Bangkok', 'Dubai', 'Jakarta',
  'Tanzania', 'Uganda', 'Kenya', 'Philippines', 'Vietnam',
]);

function getCoords(client: MapClient): [number, number] | null {
  if (client.state && INTL_STATES.has(client.state)) return null;
  if (!client.state && !client.city) return null;

  const numId = parseInt(client.id, 10) || 0;

  // City lookup (more precise)
  if (client.city) {
    const key = Object.keys(CITY_COORDS).find(
      k => k.toLowerCase() === client.city!.toLowerCase(),
    );
    if (key) {
      const [lng, lat] = CITY_COORDS[key];
      return [
        lng + ((numId * 0.007) % 0.4) - 0.2,
        lat + ((numId * 0.011) % 0.4) - 0.2,
      ];
    }
  }

  // State center fallback (larger jitter to spread dots)
  if (client.state) {
    const normalized = client.state.split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
    const key = STATE_CENTERS[normalized] ? normalized
      : Object.keys(STATE_CENTERS).find(
          k => k.toLowerCase() === client.state!.toLowerCase(),
        );
    if (key) {
      const [lng, lat] = STATE_CENTERS[key];
      return [
        lng + ((numId * 0.031) % 3.0) - 1.5,
        lat + ((numId * 0.019) % 3.0) - 1.5,
      ];
    }
  }

  return null;
}

function dotColor(lastVisit: string | null): string {
  if (!lastVisit) return '#DC2626';
  const days = Math.floor((Date.now() - new Date(lastVisit).getTime()) / 86_400_000);
  if (days < 0)    return '#DC2626';  // future date (planned visit) → treat as never
  if (days <= 30)  return '#0E9F6E';
  if (days <= 90)  return '#D97706';
  return '#DC2626';
}

// ── Component ──────────────────────────────────────────────────

interface TooltipState {
  name: string; location: string; lastVisit: string; x: number; y: number;
}

const MAX_DOTS = 600;

export function IndiaMap({ clients }: { clients: MapClient[] }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const sampled = clients.length > MAX_DOTS
    ? clients.filter((_, i) => i % Math.ceil(clients.length / MAX_DOTS) === 0)
    : clients;

  const plotted = sampled
    .map(c => ({ client: c, coords: getCoords(c) }))
    .filter((x): x is { client: MapClient; coords: [number, number] } => x.coords !== null);

  const intlCount = clients.filter(c => c.state && INTL_STATES.has(c.state)).length;

  return (
    <div style={{ position: 'relative', background: '#F4F7FC', borderRadius: 8, overflow: 'hidden' }}>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ center: [82.5, 22], scale: 1000 }}
        style={{ width: '100%', height: 520 }}
      >
        <ZoomableGroup center={[82.5, 22]} zoom={1} minZoom={0.8} maxZoom={8}>
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map(geo => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="#E8EDF5"
                  stroke="#B8C9E8"
                  strokeWidth={0.5}
                  style={{
                    default: { outline: 'none' },
                    hover:   { fill: '#D0DCF0', outline: 'none' },
                    pressed: { outline: 'none' },
                  }}
                />
              ))
            }
          </Geographies>

          {plotted.map(({ client, coords }) => (
            <Marker
              key={client.id}
              coordinates={coords}
              onMouseEnter={(e) => {
                const svg = (e.target as SVGElement).closest('svg');
                const rect = svg ? svg.getBoundingClientRect() : { left: 0, top: 0 };
                const me = e as unknown as MouseEvent;
                setTooltip({
                  name:      client.legal_name,
                  location:  [client.city, client.state].filter(Boolean).join(', '),
                  lastVisit: client.last_visit_date &&
                    new Date(client.last_visit_date).setHours(0, 0, 0, 0) <= new Date().setHours(0, 0, 0, 0)
                    ? new Date(client.last_visit_date).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      })
                    : 'Never visited',
                  x: me.clientX - rect.left,
                  y: me.clientY - rect.top,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              <circle
                r={client.tier === 'Key' ? 4 : 2.5}
                fill={dotColor(client.last_visit_date)}
                fillOpacity={0.82}
                stroke="white"
                strokeWidth={0.5}
                style={{ cursor: 'pointer' }}
              />
            </Marker>
          ))}
        </ZoomableGroup>
      </ComposableMap>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'absolute', left: tooltip.x + 14, top: tooltip.y - 12,
          background: 'white', border: '1px solid #DDE6F5',
          borderRadius: 7, padding: '8px 12px',
          fontSize: 12, boxShadow: '0 4px 16px rgba(10,61,143,0.12)',
          pointerEvents: 'none', zIndex: 100, maxWidth: 240,
        }}>
          <div style={{ fontWeight: 600, color: '#0D1B2A', marginBottom: 2 }}>
            {tooltip.name}
          </div>
          <div style={{ color: '#6B7FA3', fontSize: 11 }}>{tooltip.location}</div>
          <div style={{
            marginTop: 5, fontSize: 11,
            color: tooltip.lastVisit === 'Never visited' ? '#DC2626' : '#2C3E5A',
          }}>
            Last visit: {tooltip.lastVisit}
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 12, left: 12,
        background: 'white', border: '1px solid #DDE6F5',
        borderRadius: 6, padding: '8px 12px',
        fontSize: 11, color: '#6B7FA3',
        display: 'flex', flexDirection: 'column', gap: 5,
      }}>
        {[
          { color: '#0E9F6E', label: 'Visited < 30 days' },
          { color: '#D97706', label: '30–90 days' },
          { color: '#DC2626', label: 'Overdue / Never' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
            {l.label}
          </div>
        ))}
        <div style={{ marginTop: 3, paddingTop: 5, borderTop: '1px solid #EBF1FB', fontSize: 10, lineHeight: 1.5 }}>
          Large dot = Key account<br />Scroll to zoom · Drag to pan
        </div>
      </div>

      {/* Client count */}
      <div style={{
        position: 'absolute', bottom: 12, right: 12,
        background: 'white', border: '1px solid #DDE6F5',
        borderRadius: 6, padding: '6px 10px',
        fontSize: 11, color: '#6B7FA3',
      }}>
        {plotted.length} of {clients.length} clients plotted
        {intlCount > 0 && ` · ${intlCount} international not shown`}
      </div>
    </div>
  );
}
