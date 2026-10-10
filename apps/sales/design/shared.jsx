// shared.jsx — icons + small components shared across screens
// Exposed via window.

// ─── Icons (stroke-based, currentColor) ──────────────────────
const Ic = {};
const mkIcon = (path, vb = '0 0 16 16') => (props = {}) => (
  <svg width={props.size || 16} height={props.size || 16} viewBox={vb}
       fill="none" stroke="currentColor" strokeWidth={props.sw || 1.5}
       strokeLinecap="round" strokeLinejoin="round" style={props.style}>{path}</svg>
);

Ic.search = mkIcon(<><circle cx="7" cy="7" r="5"/><path d="M14 14l-3.5-3.5"/></>);
Ic.bell = mkIcon(<><path d="M4 6.5a4 4 0 1 1 8 0c0 3 1 4 1 4H3s1-1 1-4z"/><path d="M6.5 13.5a1.5 1.5 0 0 0 3 0"/></>);
Ic.user = mkIcon(<><circle cx="8" cy="6" r="2.5"/><path d="M3 14c0-2.5 2.2-4 5-4s5 1.5 5 4"/></>);
Ic.chevDown = mkIcon(<path d="M4 6.5 8 10.5 12 6.5"/>);
Ic.chevRight = mkIcon(<path d="M6 4l4 4-4 4"/>);
Ic.chevLeft = mkIcon(<path d="M10 4 6 8l4 4"/>);
Ic.arrowUp = mkIcon(<><path d="M8 13V3"/><path d="M4 7l4-4 4 4"/></>);
Ic.arrowDown = mkIcon(<><path d="M8 3v10"/><path d="M4 9l4 4 4-4"/></>);
Ic.arrowRight = mkIcon(<><path d="M3 8h10"/><path d="M9 4l4 4-4 4"/></>);
Ic.plus = mkIcon(<><path d="M8 3v10M3 8h10"/></>);
Ic.dots = mkIcon(<><circle cx="3" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r="1" fill="currentColor" stroke="none"/></>);
Ic.filter = mkIcon(<path d="M2 4h12M4 8h8M6 12h4"/>);
Ic.layers = mkIcon(<><path d="M8 2 2 5l6 3 6-3-6-3z"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3"/></>);
Ic.client = mkIcon(<><path d="M2 14V6l6-3 6 3v8"/><path d="M6 14V9h4v5"/></>);
Ic.cal = mkIcon(<><rect x="2" y="3" width="12" height="11" rx="1"/><path d="M2 6h12M5 2v3M11 2v3"/></>);
Ic.map = mkIcon(<><path d="M2 4l4-1 4 1 4-1v9l-4 1-4-1-4 1z"/><path d="M6 3v10M10 4v10"/></>);
Ic.dash = mkIcon(<><rect x="2" y="2" width="5" height="6" rx="1"/><rect x="9" y="2" width="5" height="4" rx="1"/><rect x="2" y="10" width="5" height="4" rx="1"/><rect x="9" y="8" width="5" height="6" rx="1"/></>);
Ic.pipeline = mkIcon(<><path d="M3 4h10M4 8h8M5 12h6"/></>);
Ic.tower = mkIcon(<><path d="M2 14V8l6-5 6 5v6"/><circle cx="8" cy="9" r="1.5"/></>);
Ic.bag = mkIcon(<><path d="M3 6h10l-1 8H4z"/><path d="M6 6V4a2 2 0 0 1 4 0v2"/></>);
Ic.cog = mkIcon(<><circle cx="8" cy="8" r="2"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1"/></>);
Ic.check = mkIcon(<path d="M3 8l3.5 3.5L13 5"/>);
Ic.alert = mkIcon(<><path d="M8 2l6.5 11h-13z"/><path d="M8 7v3M8 12v.5"/></>);
Ic.phone = mkIcon(<path d="M4 2.5h3l1 3-2 1c.5 1.5 2 3 3.5 3.5l1-2 3 1V12c0 .8-.7 1.5-1.5 1.5C7 13.5 2.5 9 2.5 4 2.5 3.2 3.2 2.5 4 2.5z"/>);
Ic.wa = mkIcon(<><circle cx="8" cy="8" r="6"/><path d="M5.5 8.5c.5 1.5 1.5 2.5 3 3l1-1c.3-.3.7-.3 1 0l1 .5-.5 1.5c-2 0-5-1.5-5.5-4.5l1.5-.5c.3 0 .5.3.5.5l-.5 1z" fill="currentColor" stroke="none"/></>);
Ic.mail = mkIcon(<><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 4l6 5 6-5"/></>);
Ic.pin = mkIcon(<><path d="M8 14s5-4.5 5-8.5A5 5 0 0 0 3 5.5C3 9.5 8 14 8 14z"/><circle cx="8" cy="6" r="1.8"/></>);
Ic.target = mkIcon(<><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3"/><circle cx="8" cy="8" r="1" fill="currentColor"/></>);
Ic.refresh = mkIcon(<><path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M13 2v3h-3"/></>);
Ic.download = mkIcon(<><path d="M8 2v9M4.5 7.5L8 11l3.5-3.5"/><path d="M3 14h10"/></>);
Ic.wifi = mkIcon(<><path d="M2 6c3.5-3 8.5-3 12 0"/><path d="M4.5 8.5c2-1.8 5-1.8 7 0"/><path d="M7 11c.6-.6 1.4-.6 2 0"/></>);
Ic.wifiOff = mkIcon(<><path d="M2 4l12 12"/><path d="M3 6.5c.5-.4 1-.8 1.6-1.1M7 4c2.5-.2 5 .6 7 2.4M5 8.7c1-.7 2-1.1 3.2-1.2M7 11c.6-.6 1.4-.6 2 0"/></>);
Ic.camera = mkIcon(<><rect x="2" y="4" width="12" height="9" rx="1"/><circle cx="8" cy="8.5" r="2.5"/><path d="M6 4l1-1.5h2L10 4"/></>);
Ic.mic = mkIcon(<><rect x="6" y="2" width="4" height="8" rx="2"/><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14"/></>);
Ic.list = mkIcon(<><path d="M5 4h9M5 8h9M5 12h9"/><circle cx="2.5" cy="4" r=".5" fill="currentColor"/><circle cx="2.5" cy="8" r=".5" fill="currentColor"/><circle cx="2.5" cy="12" r=".5" fill="currentColor"/></>);
Ic.kanban = mkIcon(<><rect x="2" y="2" width="3.5" height="12" rx="1"/><rect x="6.5" y="2" width="3.5" height="8" rx="1"/><rect x="11" y="2" width="3.5" height="5" rx="1"/></>);
Ic.car = mkIcon(<><path d="M2 11V8l1.5-3h9L14 8v3"/><path d="M2 11h12v2H2z"/><circle cx="5" cy="13" r=".8" fill="currentColor"/><circle cx="11" cy="13" r=".8" fill="currentColor"/></>);
Ic.sync = mkIcon(<><path d="M3 5.5c1-1.5 2.8-2.5 5-2.5 2.5 0 4.5 1.5 5.5 3.5"/><path d="M13 10.5c-1 1.5-2.8 2.5-5 2.5-2.5 0-4.5-1.5-5.5-3.5"/><path d="M11 2.5v3h3M5 13.5v-3H2"/></>);
Ic.image = mkIcon(<><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="6" cy="7" r="1.2"/><path d="M2 11l4-3 3 2.5 3-2 2 2"/></>);
Ic.note = mkIcon(<><path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3M5 8h6M5 11h4"/></>);

window.Ic = Ic;

// ─── Sparkline ─────────────────────────────────────────────
function Sparkline({ values, width = 80, height = 24, color = 'var(--accent)', fill = true }) {
  if (!values || !values.length) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1 || 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 4)).toFixed(1)}`);
  const d = `M ${pts.join(' L ')}`;
  const area = `${d} L ${width},${height} L 0,${height} Z`;
  return (
    <svg width={width} height={height} className="spark">
      {fill && <path d={area} fill={color} opacity={0.12} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={(values.length - 1) * step} cy={height - 2 - ((values[values.length - 1] - min) / range) * (height - 4)} r={2} fill={color} />
    </svg>
  );
}
window.Sparkline = Sparkline;

// ─── Bar chart ─────────────────────────────────────────────
function MiniBars({ values, labels, width = 220, height = 80, color = 'var(--accent)', target }) {
  const max = Math.max(...values, target || 0);
  const bw = (width - (values.length - 1) * 6) / values.length;
  return (
    <svg width={width} height={height + 16}>
      {target != null && (
        <line x1={0} x2={width} y1={height - (target / max) * (height - 8)} y2={height - (target / max) * (height - 8)}
              stroke="var(--accent)" strokeDasharray="3 3" strokeWidth={1} opacity={0.6}/>
      )}
      {values.map((v, i) => {
        const h = (v / max) * (height - 8);
        const x = i * (bw + 6);
        const y = height - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={h} rx={1.5} fill={i === values.length - 1 ? 'var(--accent)' : 'var(--fg-2)'} opacity={i === values.length - 1 ? 1 : 0.4} />
            {labels && <text x={x + bw/2} y={height + 12} textAnchor="middle" fontSize="9" fill="var(--fg-3)" fontFamily="var(--font-mono)">{labels[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
}
window.MiniBars = MiniBars;

// ─── Donut ─────────────────────────────────────────────────
function Donut({ data, size = 120, thick = 18, center }) {
  const total = data.reduce((s, d) => s + d.pct, 0);
  let cum = 0;
  const r = size / 2 - thick / 2;
  const c = size / 2;
  return (
    <svg width={size} height={size}>
      {data.map((d, i) => {
        const start = (cum / total) * 360 - 90;
        cum += d.pct;
        const end = (cum / total) * 360 - 90;
        const x1 = c + r * Math.cos(start * Math.PI/180);
        const y1 = c + r * Math.sin(start * Math.PI/180);
        const x2 = c + r * Math.cos(end * Math.PI/180);
        const y2 = c + r * Math.sin(end * Math.PI/180);
        const large = (end - start) > 180 ? 1 : 0;
        return <path key={i} d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`} stroke={d.color} strokeWidth={thick} fill="none" />;
      })}
      {center && (
        <foreignObject x={0} y={0} width={size} height={size}>
          <div xmlns="http://www.w3.org/1999/xhtml" style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            {center}
          </div>
        </foreignObject>
      )}
    </svg>
  );
}
window.Donut = Donut;

// ─── Sidebar (desktop chrome) ──────────────────────────────
function Sidebar({ active, role, user, alerts = {} }) {
  const items = role === 'rep' ? [
    { id: 'today', icon: Ic.cal, label: 'Today' },
    { id: 'clients', icon: Ic.client, label: 'My Clients' },
    { id: 'visits', icon: Ic.car, label: 'Visits' },
    { id: 'tasks', icon: Ic.check, label: 'Tasks', badge: alerts.tasks },
    { id: 'pipeline', icon: Ic.pipeline, label: 'My Pipeline' },
  ] : [
    { id: 'dash', icon: Ic.dash, label: 'Dashboard' },
    { id: 'clients', icon: Ic.client, label: 'Clients' },
    { id: 'visits', icon: Ic.cal, label: 'Visit Plan' },
    { id: 'map', icon: Ic.map, label: 'Coverage Map' },
    { id: 'pipeline', icon: Ic.pipeline, label: 'Pipeline' },
    { id: 'compete', icon: Ic.tower, label: 'Competitive', badge: alerts.compete },
    { id: 'revenue', icon: Ic.bag, label: 'Revenue' },
  ];
  const intel = [
    { id: 'reports', icon: Ic.note, label: 'Reports' },
    { id: 'admin', icon: Ic.cog, label: 'Admin', badge: alerts.admin, alert: true },
  ];
  return (
    <aside className="side">
      <div className="side-brand">
        <div className="logo">R</div>
        <div>
          <div className="name">Risansi</div>
          <div className="sub">Sales Intel · v1.0</div>
        </div>
      </div>
      <div className="side-group">
        <div className="side-group-label">{role === 'rep' ? 'Field' : 'Operate'}</div>
        {items.map(it => (
          <div key={it.id} className={`side-link ${it.id === active ? 'is-active' : ''}`}>
            <it.icon size={15}/>
            <span>{it.label}</span>
            {it.badge != null && <span className={`badge ${it.alert ? 'alert' : ''}`}>{it.badge}</span>}
          </div>
        ))}
      </div>
      <div className="side-group">
        <div className="side-group-label">Intelligence</div>
        {intel.map(it => (
          <div key={it.id} className={`side-link ${it.id === active ? 'is-active' : ''}`}>
            <it.icon size={15}/>
            <span>{it.label}</span>
            {it.badge != null && <span className={`badge ${it.alert ? 'alert' : ''}`}>{it.badge}</span>}
          </div>
        ))}
      </div>
      <div className="side-user">
        <div className="av">{user.initials}</div>
        <div>
          <div className="who">{user.name}</div>
          <div className="role">{user.role}</div>
        </div>
      </div>
    </aside>
  );
}
window.Sidebar = Sidebar;

// ─── Topbar ────────────────────────────────────────────────
function Topbar({ crumbs, primaryAction, syncing = 'live', period = 'FY 25-26' }) {
  return (
    <header className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Ic.chevRight size={11} style={{ opacity: 0.5 }}/>}
            {i === crumbs.length - 1 ? <strong>{c}</strong> : <span>{c}</span>}
          </React.Fragment>
        ))}
      </div>
      <div className="tb-btn">
        <span className="live-dot"/>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>Live · synced 2s ago</span>
      </div>
      <div className="search">
        <Ic.search size={13}/>
        <input placeholder="Search clients, codes, contacts…" />
        <kbd>⌘K</kbd>
      </div>
      <div className="tb-btn"><Ic.cal size={13}/>{period}<Ic.chevDown size={11}/></div>
      <div className="tb-btn"><Ic.bell size={13}/></div>
      {primaryAction && <div className="tb-btn primary"><Ic.plus size={12}/>{primaryAction}</div>}
    </header>
  );
}
window.Topbar = Topbar;

// ─── Misc small ─────────────────────────────────────────────
function StatusDot({ s }) { return <span className={`sdot ${s}`}/>; }
window.StatusDot = StatusDot;

function Tag({ kind, dot, children }) {
  return <span className={`tag ${kind || ''} ${dot ? 'dot' : ''}`}>{children}</span>;
}
window.Tag = Tag;

function Photo({ label = 'plant photo', h = 80, w = '100%' }) {
  return <div className="ph" style={{ height: h, width: w, borderRadius: 4 }}>{label}</div>;
}
window.Photo = Photo;
