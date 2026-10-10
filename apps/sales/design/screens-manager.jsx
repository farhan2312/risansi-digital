// screens-manager.jsx — Zonal Manager dashboard + Coverage Map

const { Ic, Sidebar, Topbar, Sparkline, MiniBars, Donut, StatusDot, Tag, Photo } = window;

function ManagerDashboard() {
  const user = { name: 'Himanshu Tiwari', role: 'Zonal Manager · Central', initials: 'HT' };
  return (
    <div className="ris-root app-shell">
      <Sidebar active="dash" role="manager" user={user} alerts={{compete: 2, admin: 3}}/>
      <div className="main">
        <Topbar crumbs={['Risansi', 'Central Zone', 'Manager Dashboard']} period="This Week"/>
        <div className="page">
          <div className="page-head">
            <div>
              <div className="page-title">Central Zone — Week 20</div>
              <div className="page-sub">4 reps · 87 active clients · 12 visits planned this week · 3 overdue accounts need attention</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn"><Ic.list size={12}/>Approve Week Plan</button>
              <button className="btn primary"><Ic.plus size={12}/>Assign Visit</button>
            </div>
          </div>

          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
            <Kpi label="Visits This Week" value="12 / 16" sub="planned"  delta="+2 vs last wk" pos/>
            <Kpi label="Compliance" value="78%" sub="visits on-time" delta="-3pp" pos={false}/>
            <Kpi label="Zone Pipeline" value="₹62 Cr" sub="14 open opps" delta="+₹8 Cr" pos/>
            <Kpi label="Forecast vs Target" value="₹38 / ₹46 Cr" sub="83% confidence" delta="+12% wkly" pos/>
            <Kpi label="At-Risk" value="3 accounts" sub="no order 18mo+" delta="₹4.8 Cr exposure" pos={false}/>
          </div>

          {/* Map + rep coverage */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="panel">
              <div className="panel-h">
                <span className="t">Coverage Heatmap · Central Zone</span>
                <div className="right">
                  <Tag kind="pos" dot>Compliant 64</Tag>
                  <Tag kind="warn" dot>Due soon 18</Tag>
                  <Tag kind="neg" dot>Overdue 5</Tag>
                </div>
              </div>
              <div className="panel-b" style={{ padding: 0 }}>
                <CoverageMap height={300}/>
              </div>
            </div>

            <div className="panel">
              <div className="panel-h">
                <span className="t">Rep Performance · Week 20</span>
              </div>
              <div className="panel-b dense">
                <table className="tbl">
                  <thead><tr><th>Rep</th><th className="center">Visits</th><th className="center">Comply</th><th className="right">Pipeline</th></tr></thead>
                  <tbody>
                    <RepRow init="HT" name="Himanshu Tiwari" route="M.P.-2" visits="6/6" comply={100} pl={24.4} self/>
                    <RepRow init="VK" name="Vikram Khanna" route="M.P.-1" visits="4/5" comply={80} pl={18.2}/>
                    <RepRow init="ND" name="Nilesh Desai" route="Central-1" visits="2/3" comply={67} pl={11.6}/>
                    <RepRow init="RA" name="Rohit Agarwal" route="Central-2" visits="0/2" comply={0} pl={7.8} flag/>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Today's visit list + at-risk + tasks */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>
            <div className="panel">
              <div className="panel-h">
                <span className="t">Today · Live Visit Activity</span>
                <span className="meta">May 16 · 14:32 IST</span>
              </div>
              <div className="panel-b dense">
                <table className="tbl">
                  <thead><tr><th>Time</th><th>Client</th><th>Rep</th><th>Purpose</th><th>Status</th><th>Outcome</th><th></th></tr></thead>
                  <tbody>
                    <VisitRow time="09:14" client="Praj Indore" code="INDR01A003" rep="HT" purpose="Quote follow-up" status="completed" outcome="Very Positive"/>
                    <VisitRow time="10:48" client="Vippy Industries" code="UJJN02A011" rep="VK" purpose="Routine" status="completed" outcome="Positive"/>
                    <VisitRow time="11:20" client="Daawat Foods" code="JBLP01A004" rep="ND" purpose="Complaint resolution" status="checked-in" outcome=""/>
                    <VisitRow time="13:00" client="Mahalaxmi Mill" code="UJJN01A007" rep="VK" purpose="Equipment assessment" status="checked-in" outcome=""/>
                    <VisitRow time="14:30" client="Ujjain Distillery" code="UJJN03A002" rep="HT" purpose="New opportunity" status="en-route" outcome=""/>
                    <VisitRow time="16:00" client="Sajjan Mills" code="BHPL01A005" rep="ND" purpose="Routine" status="planned" outcome=""/>
                    <VisitRow time="17:00" client="Vidisha Sugar" code="VIDS01A001" rep="RA" purpose="Mgmt visit" status="missed" outcome="" warn/>
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              <div className="panel">
                <div className="panel-h"><span className="t">At-Risk Accounts</span><div className="right"><Tag kind="neg">3 in zone</Tag></div></div>
                <div className="panel-b" style={{ padding: 0 }}>
                  <AtRiskRow name="Vidisha Co-op Sugar" code="VIDS01A001" lastOrder="22 months ago" lastVisit="14 months ago" exposure="₹2.4 Cr"/>
                  <AtRiskRow name="Bina Pulp & Paper" code="SAGR01A003" lastOrder="19 months ago" lastVisit="6 months ago" exposure="₹1.6 Cr"/>
                  <AtRiskRow name="Mhow Cattle Feed" code="MHOW01A002" lastOrder="20 months ago" lastVisit="8 months ago" exposure="₹0.8 Cr"/>
                </div>
              </div>
              <div className="panel">
                <div className="panel-h"><span className="t">Pending Approvals</span><div className="right"><Tag kind="warn">5</Tag></div></div>
                <div className="panel-b" style={{ padding: 0 }}>
                  <ApprovalRow type="Manual GPS Override" who="ND" detail="Daawat Foods · 1.4km from registered point"/>
                  <ApprovalRow type="Status Change" who="VK" detail="Mahalaxmi Mill: Active → Inactive"/>
                  <ApprovalRow type="New Contact" who="HT" detail="Praj Indore: Mr Patil (Chief Engineer)"/>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, delta, pos }) {
  return (
    <div className="panel">
      <div className="panel-b" style={{ padding: 12 }}>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>{label}</div>
        <div className="num" style={{ fontSize: 22, marginTop: 4, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{sub}</div>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: pos ? 'var(--pos)' : 'var(--neg)', marginTop: 6 }}>
          {pos ? '▲' : '▼'} {delta}
        </div>
      </div>
    </div>
  );
}

// Coverage map — abstract dot map of India with clustered pins
function CoverageMap({ height = 320 }) {
  // Roughly-positioned client dots across India shape
  const dots = [
    // overdue (red)
    { x: 70, y: 240, s: 6, c: 'var(--neg)' }, { x: 200, y: 160, s: 6, c: 'var(--neg)' },
    { x: 410, y: 120, s: 6, c: 'var(--neg)' }, { x: 180, y: 300, s: 5, c: 'var(--neg)' },
    { x: 300, y: 240, s: 5, c: 'var(--neg)' },
    // due soon (warn)
    { x: 120, y: 180, s: 4, c: 'var(--warn)' }, { x: 240, y: 200, s: 4, c: 'var(--warn)' },
    { x: 360, y: 200, s: 4, c: 'var(--warn)' }, { x: 280, y: 120, s: 4, c: 'var(--warn)' },
    { x: 440, y: 220, s: 4, c: 'var(--warn)' }, { x: 160, y: 240, s: 4, c: 'var(--warn)' },
    { x: 320, y: 280, s: 4, c: 'var(--warn)' }, { x: 220, y: 280, s: 4, c: 'var(--warn)' },
    { x: 400, y: 280, s: 4, c: 'var(--warn)' },
    // compliant (green) - many
    ...Array.from({ length: 38 }, (_, i) => ({
      x: 80 + (i * 41 % 400) + (i % 3) * 7,
      y: 100 + (i * 23 % 220) + (i % 5) * 3,
      s: 3, c: 'var(--pos)',
    })),
  ];
  // Cluster halos
  return (
    <div className="map-grid" style={{ height, position: 'relative' }}>
      <svg width="100%" height={height} viewBox={`0 0 600 ${height}`} preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0 }}>
        {/* outline shape (very abstract India outline) */}
        <path d="M120 80 L180 60 L250 50 L320 60 L380 80 L440 110 L480 160 L500 220 L470 280 L420 320 L360 340 L290 350 L220 340 L160 310 L110 270 L80 220 L70 160 Z"
              fill="rgba(255,255,255,0.4)" stroke="rgba(28,26,23,0.15)" strokeWidth="1" strokeDasharray="2 3"/>
        {/* Route lines */}
        <path d="M180 300 L200 280 L240 260 L270 240" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" fill="none"/>
        <path d="M300 150 L340 170 L380 200" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" fill="none"/>

        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.s} fill={d.c} opacity={0.85}/>
        ))}
        {/* Selected pin */}
        <g transform="translate(270, 230)">
          <circle r="14" fill="var(--accent)" opacity="0.18"/>
          <circle r="6" fill="var(--accent)"/>
          <circle r="2" fill="#fff"/>
        </g>

        {/* zone labels */}
        <text x="140" y="180" fontSize="9" fill="var(--fg-3)" fontFamily="var(--font-mono)">N · UP</text>
        <text x="270" y="280" fontSize="9" fill="var(--fg-3)" fontFamily="var(--font-mono)">W · MH/GJ</text>
        <text x="380" y="160" fontSize="9" fill="var(--fg-3)" fontFamily="var(--font-mono)">C · MP</text>
        <text x="380" y="310" fontSize="9" fill="var(--fg-3)" fontFamily="var(--font-mono)">S · KA/TN</text>
      </svg>

      {/* Tooltip */}
      <div style={{ position: 'absolute', top: 132, left: 296, background: 'var(--bg-elev)', border: '1px solid var(--line-2)', borderRadius: 6, padding: 10, fontSize: 11, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', minWidth: 180 }}>
        <div style={{ fontWeight: 500, fontSize: 12 }}>Praj Indore</div>
        <div className="code" style={{ color: 'var(--fg-3)', fontSize: 10 }}>INDR01A003 · Distillery · 90 KLPD</div>
        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          <span>Last: 16 days</span>
          <span style={{ color: 'var(--pos)' }}>● compliant</span>
        </div>
      </div>

      <div style={{ position: 'absolute', top: 12, left: 14, fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>
        87 ACCOUNTS · CENTRAL ZONE
      </div>
      <div style={{ position: 'absolute', bottom: 12, right: 14, background: 'var(--bg-elev)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '6px 10px', fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
        <div>10 km</div>
      </div>
    </div>
  );
}
window.CoverageMap = CoverageMap;

function RepRow({ init, name, route, visits, comply, pl, self, flag }) {
  return (
    <tr>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 4, background: self ? 'var(--accent)' : 'var(--bg-sunk)', color: self ? '#fff' : 'var(--fg-2)', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 600 }}>{init}</div>
          <div>
            <div className="name">{name} {self && <span style={{ color: 'var(--fg-3)', fontWeight: 400 }}>· you</span>}</div>
            <div className="sub">{route}</div>
          </div>
        </div>
      </td>
      <td className="center num">{visits}</td>
      <td className="center">
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <div className="bar" style={{ width: 40 }}>
            <div className="fill" style={{ width: `${comply}%`, background: comply >= 80 ? 'var(--pos)' : comply >= 50 ? 'var(--warn)' : 'var(--neg)' }}/>
          </div>
          <span className="num" style={{ fontSize: 11 }}>{comply}%</span>
        </div>
      </td>
      <td className="right num">₹{pl.toFixed(1)} Cr {flag && <span style={{ color: 'var(--neg)' }}>!</span>}</td>
    </tr>
  );
}

function VisitRow({ time, client, code, rep, purpose, status, outcome, warn }) {
  const statusColors = {
    'completed': 'pos', 'checked-in': 'info', 'en-route': 'warn', 'planned': null, 'missed': 'neg'
  };
  return (
    <tr>
      <td className="num">{time}</td>
      <td>
        <div className="name">{client}</div>
        <div className="sub code">{code}</div>
      </td>
      <td className="muted" style={{ fontSize: 11 }}>{rep}</td>
      <td style={{ fontSize: 11 }}>{purpose}</td>
      <td><Tag kind={statusColors[status]} dot>{status}</Tag></td>
      <td>{outcome && <span style={{ fontSize: 11 }}>{outcome}</span>}</td>
      <td><Ic.chevRight size={12} style={{ opacity: 0.4 }}/></td>
    </tr>
  );
}

function AtRiskRow({ name, code, lastOrder, lastVisit, exposure }) {
  return (
    <div className="row-data">
      <div style={{ width: 4, alignSelf: 'stretch', background: 'var(--neg)', borderRadius: 2 }}/>
      <div className="grow">
        <div className="t">{name}</div>
        <div className="s code">{code} · last order {lastOrder} · visited {lastVisit}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="num" style={{ fontSize: 12, color: 'var(--neg)' }}>{exposure}</div>
        <button className="btn sm ghost" style={{ marginTop: 4 }}>Assign visit →</button>
      </div>
    </div>
  );
}

function ApprovalRow({ type, who, detail }) {
  return (
    <div className="row-data">
      <div className="grow">
        <div style={{ fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{type} · {who}</div>
        <div className="s" style={{ fontSize: 12, color: 'var(--fg)' }}>{detail}</div>
      </div>
      <button className="btn sm">Review</button>
    </div>
  );
}

window.ManagerDashboard = ManagerDashboard;
