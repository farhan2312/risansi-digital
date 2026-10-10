'use client';

// ── Types ──────────────────────────────────────────────────────

export interface ClientPin {
  id:               string;
  code:             string;
  legal_name:       string;
  industry:         string | null;
  city:             string | null;
  state:            string | null;
  tier:             string | null;
  last_visit_date:  string | null;
  days_since:       number | null;
  rep_name:         string;
}

// ── State → SVG coordinate map (viewBox 0 0 800 900) ──────────

const STATE_POSITIONS: Record<string, [number, number]> = {
  // North
  'Jammu And Kashmir':      [320, 60],
  'Himachal Pradesh':       [340, 110],
  'Punjab':                 [290, 135],
  'Uttarakhand':            [390, 140],
  'Haryana':                [310, 170],
  'Delhi':                  [330, 185],
  'Uttar Pradesh':          [420, 200],
  'Rajasthan':              [250, 230],

  // Central
  'Madhya Pradesh':         [360, 310],
  'Chhattisgarh':           [470, 340],
  'Bihar':                  [520, 220],
  'Jharkhand':              [530, 270],

  // West
  'Gujarat':                [195, 290],
  'Maharashtra':            [300, 390],
  'Goa':                    [255, 460],
  'Dadra & Nagar Haveli':   [220, 340],

  // South
  'Karnataka':              [290, 490],
  'Telangana':              [390, 430],
  'Andhra Pradesh':         [420, 480],
  'Tamil Nadu':             [370, 570],
  'Kerala':                 [285, 570],
  'Puducherry':             [390, 555],

  // East
  'West Bengal':            [570, 260],
  'Odisha':                 [530, 360],
  'Assam':                  [650, 190],

  'default':                [400, 350],
};

const DENSE_STATES = new Set([
  'Maharashtra', 'Uttar Pradesh', 'Gujarat',
  'Karnataka', 'Tamil Nadu', 'Rajasthan',
  'Punjab', 'Haryana', 'Andhra Pradesh',
]);

const INDIAN_STATES = new Set([
  'Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jammu And Kashmir', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Dadra & Nagar Haveli',
]);

// ── Helpers ────────────────────────────────────────────────────

function normalizeState(s: string): string {
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function getDotPosition(client: ClientPin): [number, number] {
  const raw        = client.state ?? 'default';
  const norm       = normalizeState(raw);
  const base       = STATE_POSITIONS[norm] ?? STATE_POSITIONS[raw] ?? STATE_POSITIONS['default'];
  const spread     = DENSE_STATES.has(norm) ? 55 : 30;
  const numId      = parseInt(client.id, 10) || 0;
  const jx         = ((numId * 7919) % (spread * 2)) - spread;
  const jy         = ((numId * 6271) % (spread * 2)) - spread;
  return [
    Math.max(130, Math.min(720, base[0] + jx)),
    Math.max(50,  Math.min(730, base[1] + jy)),
  ];
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

const MAX_DOTS = 400;

export function CoverageMapSvg({ clients }: { clients: ClientPin[] }) {
  const indiaClients = clients.filter(c =>
    c.state && INDIAN_STATES.has(normalizeState(c.state)),
  );
  const intlCount = clients.length - indiaClients.length;

  const mapClients = indiaClients.length > MAX_DOTS
    ? indiaClients.filter((_: ClientPin, i: number) =>
        i % Math.ceil(indiaClients.length / MAX_DOTS) === 0,
      )
    : indiaClients;

  return (
    <div style={{ position: 'relative', width: '100%', userSelect: 'none' }}>
      <svg
        viewBox="0 0 800 900"
        style={{ width: '100%', height: 'auto', maxHeight: 520, display: 'block' }}
      >
        {/* India mainland outline */}
        <path
          d="
            M 370 55
            L 420 50 L 460 65 L 490 90
            L 510 80 L 540 90 L 550 120
            L 530 140 L 560 150 L 570 180
            L 600 190 L 620 220 L 610 250
            L 640 260 L 670 240 L 690 260
            L 680 290 L 650 300 L 640 330
            L 610 340 L 590 370 L 570 400
            L 580 430 L 560 460 L 540 490
            L 510 520 L 490 550 L 470 580
            L 450 610 L 430 640 L 420 670
            L 410 690 L 400 720
            L 390 700 L 375 670
            L 360 640 L 340 610
            L 320 580 L 300 550
            L 280 520 L 265 490
            L 240 460 L 220 430
            L 200 400 L 185 370
            L 170 340 L 160 310
            L 150 280 L 145 250
            L 148 220 L 155 195
            L 170 170 L 190 150
            L 210 130 L 230 110
            L 260 90 L 290 72
            L 330 58 Z
          "
          fill="rgba(10,61,143,0.05)"
          stroke="rgba(10,61,143,0.25)"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />

        {/* Andaman & Nicobar */}
        <ellipse cx="680" cy="520" rx="12" ry="30"
          fill="rgba(10,61,143,0.05)"
          stroke="rgba(10,61,143,0.20)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        {/* Zone labels */}
        <text x="420" y="155" fontSize="11" fill="rgba(10,61,143,0.35)" fontFamily="IBM Plex Mono, monospace" textAnchor="middle" letterSpacing="2">NORTH</text>
        <text x="200" y="280" fontSize="11" fill="rgba(10,61,143,0.35)" fontFamily="IBM Plex Mono, monospace" textAnchor="middle" letterSpacing="2">WEST</text>
        <text x="400" y="320" fontSize="11" fill="rgba(10,61,143,0.35)" fontFamily="IBM Plex Mono, monospace" textAnchor="middle" letterSpacing="2">CENTRAL</text>
        <text x="590" y="300" fontSize="11" fill="rgba(10,61,143,0.35)" fontFamily="IBM Plex Mono, monospace" textAnchor="middle" letterSpacing="2">EAST</text>
        <text x="350" y="530" fontSize="11" fill="rgba(10,61,143,0.35)" fontFamily="IBM Plex Mono, monospace" textAnchor="middle" letterSpacing="2">SOUTH</text>

        {/* Client dots */}
        {mapClients.map((client) => {
          const [cx, cy] = getDotPosition(client);
          const color    = dotColor(client.last_visit_date);
          const r        = (client.tier === 'Key' || client.tier === 'A') ? 4 : 2.5;
          return (
            <circle
              key={client.id}
              cx={cx} cy={cy} r={r}
              fill={color}
              opacity={0.75}
              style={{ cursor: 'pointer' }}
            >
              <title>
                {client.legal_name} · {client.city ?? ''}{client.city && client.state ? ', ' : ''}{client.state ?? ''}
                {'\n'}Last visit: {client.last_visit_date
                  ? new Date(client.last_visit_date).toLocaleDateString('en-IN')
                  : 'Never'}
              </title>
            </circle>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 20, justifyContent: 'center',
        alignItems: 'center', marginTop: 8, fontSize: 11,
        color: 'var(--fg-3)', flexWrap: 'wrap',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#0E9F6E', flexShrink: 0 }} />
          Visited &lt; 30 days
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#D97706', flexShrink: 0 }} />
          30–90 days
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#DC2626', flexShrink: 0 }} />
          Overdue / Never
        </span>
        <span style={{ marginLeft: 8 }}>
          Dot size: Key = large · Standard = small
        </span>
      </div>

      {/* Caption */}
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
        Showing {mapClients.length} of {indiaClients.length} India clients
        {intlCount > 0 && ` · ${intlCount} international client${intlCount !== 1 ? 's' : ''} not shown`}
      </div>
    </div>
  );
}
