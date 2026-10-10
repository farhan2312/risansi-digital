// screens-client.jsx — Client 360 profile, Visit Calendar, Compete intel, Admin

const { Ic, Sidebar, Topbar, Sparkline, MiniBars, Donut, StatusDot, Tag, Photo } = window;

// ─────────────────────────────────────────────────────────────
// CLIENT 360 — Dalmia Kolhapur
// ─────────────────────────────────────────────────────────────
function ClientProfile() {
  const user = { name: 'Himanshu Tiwari', role: 'Zonal Manager · Central', initials: 'HT' };
  const c = RIS.clients.find(x => x.code === 'KOLH02A004');
  const revYears = ['21-22','22-23','23-24','24-25','25-26'];
  return (
    <div className="ris-root app-shell">
      <Sidebar active="clients" role="manager" user={user}/>
      <div className="main">
        <Topbar crumbs={['Clients', 'West Zone', c.trade]}/>
        <div className="page">
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="page-title" style={{ marginBottom: 0 }}>{c.legal}</div>
                <Tag kind="pos" dot>{c.status}</Tag>
                <Tag kind="accent">Key Account</Tag>
              </div>
              <div className="page-sub" style={{ marginTop: 6 }}>
                <span className="mono">{c.code}</span>
                <span style={{ margin: '0 8px' }}>·</span>
                {c.industry} · {c.tcd} TCD · {c.klpd} KLPD
                <span style={{ margin: '0 8px' }}>·</span>
                {c.address}
                <span style={{ margin: '0 8px' }}>·</span>
                Customer since {c.sinceYear} · {RIS.repById(c.rep).name} on {c.route}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn"><Ic.cal size={12}/>Plan Visit</button>
              <button className="btn"><Ic.note size={12}/>New Opportunity</button>
              <button className="btn primary"><Ic.list size={12}/>Edit Record</button>
            </div>
          </div>

          {/* Top KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 14 }}>
            <MiniKpi label="Lifetime Revenue" value="₹85.1 Cr" sub="2018 – present · 142 orders"/>
            <MiniKpi label="Last Visit" value="91 days" sub="overdue · Akshay Pawar" neg/>
            <MiniKpi label="Installed Base" value={`${c.pumpsRIL} / ${c.pumpsTotal} pumps`} sub="36% RIL share (PCP+MMP)"/>
            <MiniKpi label="Open Pipeline" value="₹36.8 Cr" sub="1 quoted · 60% confidence"/>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 14 }}>
            {/* Left column */}
            <div style={{ display: 'grid', gap: 14 }}>
              {/* Revenue history */}
              <div className="panel">
                <div className="panel-h">
                  <span className="t">Year-on-Year Revenue · Pump vs Spare</span>
                  <div className="right"><Tag>5-yr CAGR +28%</Tag><button className="btn sm ghost">FY 25–26 ▾</button></div>
                </div>
                <div className="panel-b">
                  <RevenueChart years={revYears} pump={[8.2,10.4,17.2,22.4,5.6]} spare={[4.2,4.5,5.3,5.7,1.6]} height={140}/>
                  <table className="tbl" style={{ marginTop: 16, fontSize: 11 }}>
                    <thead><tr>
                      <th></th>{revYears.map(y => <th key={y} className="right">FY {y}</th>)}<th className="right">Total</th>
                    </tr></thead>
                    <tbody>
                      <tr><td>Pump (₹ Cr)</td><td className="right num">8.2</td><td className="right num">10.4</td><td className="right num">17.2</td><td className="right num">22.4</td><td className="right num">5.6</td><td className="right num" style={{ fontWeight: 500 }}>63.8</td></tr>
                      <tr><td>Spare (₹ Cr)</td><td className="right num">4.2</td><td className="right num">4.5</td><td className="right num">5.3</td><td className="right num">5.7</td><td className="right num">1.6</td><td className="right num" style={{ fontWeight: 500 }}>21.3</td></tr>
                      <tr style={{ background: 'var(--bg-paper)' }}><td style={{ fontWeight: 500 }}>Total</td><td className="right num">12.4</td><td className="right num">14.9</td><td className="right num">22.5</td><td className="right num">28.1</td><td className="right num">7.2</td><td className="right num" style={{ fontWeight: 500 }}>85.1</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Installed Base */}
              <div className="panel">
                <div className="panel-h">
                  <span className="t">Installed Base Register · 22 pumps</span>
                  <span className="meta">Last assessed 14 Feb 2026 by Akshay Pawar</span>
                  <div className="right"><Tag kind="warn">2 displacement opps</Tag></div>
                </div>
                <div className="panel-b dense">
                  <table className="tbl">
                    <thead><tr><th>Station</th><th>Type</th><th>Supplier</th><th>Model</th><th className="center">Qty</th><th>Condition</th><th></th></tr></thead>
                    <tbody>
                      {RIS.equipmentDalmia.map(e => (
                        <tr key={e.id} style={ e.opportunity ? { background: 'oklch(0.97 0.04 50)' } : {}}>
                          <td>{e.station}</td>
                          <td><Tag>{e.type}</Tag></td>
                          <td>
                            <span style={{ fontWeight: e.supplier === 'RIL' ? 500 : 400, color: e.supplier === 'RIL' ? 'var(--accent)' : 'inherit' }}>
                              {e.supplier}
                            </span>
                          </td>
                          <td className="code">{e.model}</td>
                          <td className="center num">{e.qty}</td>
                          <td>
                            <Tag kind={e.condition === 'Good' ? 'pos' : e.condition === 'Requires Maintenance' ? 'warn' : 'neg'} dot>
                              {e.condition}
                            </Tag>
                          </td>
                          <td>{e.opportunity && <Tag kind="accent">REPLACE</Tag>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Visit history */}
              <div className="panel">
                <div className="panel-h">
                  <span className="t">Visit Timeline · 18 visits in last 24 months</span>
                  <div className="right"><button className="btn sm ghost">View all</button></div>
                </div>
                <div className="panel-b" style={{ padding: 0 }}>
                  <VisitTimelineRow date="14 Feb 2026" who="Akshay Pawar" purpose="Equipment Assessment" outcome="Neutral" notes="Logged 8 equipment entries — 2 end-of-life Netzsch units flagged for displacement. Mr Joshi mentioned 2025-26 capex review in May." gps="GPS verified ±18m"/>
                  <VisitTimelineRow date="03 Dec 2025" who="Akshay Pawar" purpose="Quote Follow-up" outcome="Positive" notes="Quote Q-2024-018 for 3× PCP MX-80 acknowledged. Procurement to confirm by end-Jan."/>
                  <VisitTimelineRow date="07 Oct 2025" who="Mahesh Joshi" purpose="Mgmt Relationship" outcome="Very Positive" notes="Met MD; aligned on 5-yr partnership framework."/>
                  <VisitTimelineRow date="22 Aug 2025" who="Akshay Pawar" purpose="Complaint Resolution" outcome="Positive" notes="Resolved leakage on MMP at boiler feed. Replacement seal dispatched."/>
                </div>
              </div>
            </div>

            {/* Right column */}
            <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
              {/* Contacts */}
              <div className="panel">
                <div className="panel-h"><span className="t">Contacts</span><div className="right"><button className="btn sm ghost"><Ic.plus size={11}/>Add</button></div></div>
                <div className="panel-b" style={{ padding: 0 }}>
                  <ContactRow name="Mr Sanjay Joshi" role="GM Engineering" primary phone="+91 98220 18342" mail="s.joshi@dalmiakolh.com"/>
                  <ContactRow name="Mr Ravi Patil" role="Chief Engineer" phone="+91 97651 24411" mail="r.patil@dalmiakolh.com"/>
                  <ContactRow name="Mrs Geeta Kulkarni" role="Purchase Officer" phone="+91 99875 60123" mail="g.kulkarni@dalmiakolh.com"/>
                  <ContactRow name="Mr Ashok Deshmukh" role="MD · Dalmia Bharat Sugar" phone="+91 98119 04201" mail="ashok.d@dalmiabharat.com"/>
                </div>
              </div>

              {/* Map */}
              <div className="panel">
                <div className="panel-h"><span className="t">Plant Location</span><div className="right"><button className="btn sm ghost"><Ic.map size={11}/>Open Maps</button></div></div>
                <div style={{ position: 'relative' }}>
                  <div className="map-grid" style={{ height: 150 }}>
                    <svg width="100%" height="150" viewBox="0 0 300 150" style={{ position: 'absolute', inset: 0 }}>
                      <path d="M20 100 Q60 60 120 70 Q200 80 280 50" stroke="rgba(28,26,23,0.18)" fill="none" strokeWidth="2"/>
                      <path d="M30 130 L80 110 L160 130 L230 100" stroke="rgba(28,26,23,0.12)" fill="none" strokeWidth="1" strokeDasharray="3 2"/>
                      <g transform="translate(160,80)">
                        <circle r="20" fill="var(--accent)" opacity="0.15"/>
                        <circle r="10" fill="var(--accent)" opacity="0.3"/>
                        <circle r="5" fill="var(--accent)"/>
                      </g>
                    </svg>
                  </div>
                  <div style={{ padding: 12, fontSize: 11, color: 'var(--fg-3)', borderTop: '1px solid var(--line)', fontFamily: 'var(--font-mono)' }}>
                    16.6925° N, 74.2433° E · Kolhapur, MH
                  </div>
                </div>
              </div>

              {/* Open opportunities */}
              <div className="panel">
                <div className="panel-h"><span className="t">Open Pipeline</span></div>
                <div className="panel-b" style={{ padding: 0 }}>
                  <PipelineMini id="P-2635" product="PCP × 3 MX-80" stage="Quoted" value={36.8} prob={60} eta="Jun 2026"/>
                  <PipelineMini id="P-2611" product="Spares quarterly" stage="Suspect" value={4.2} prob={25} eta="Q2"/>
                </div>
              </div>

              {/* Audit */}
              <div className="panel">
                <div className="panel-h"><span className="t">Activity Log</span></div>
                <div className="panel-b" style={{ padding: 0 }}>
                  <AuditRow who="AP" t="14 Feb" what="submitted equipment assessment (8 items)"/>
                  <AuditRow who="System" t="14 Feb" what="flagged 2 replacement opportunities"/>
                  <AuditRow who="Back-office" t="11 Feb" what="entered order PO-2025-0492 · ₹2.4 Cr"/>
                  <AuditRow who="HT" t="07 Feb" what="changed tier: Standard → Key"/>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniKpi({ label, value, sub, neg }) {
  return (
    <div className="panel">
      <div className="panel-b" style={{ padding: 12 }}>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
        <div className="num" style={{ fontSize: 20, marginTop: 4, color: neg ? 'var(--neg)' : 'inherit' }}>{value}</div>
        <div style={{ fontSize: 11, color: neg ? 'var(--neg)' : 'var(--fg-3)', marginTop: 3 }}>{sub}</div>
      </div>
    </div>
  );
}

function RevenueChart({ years, pump, spare, height = 120 }) {
  const max = Math.max(...years.map((_, i) => pump[i] + spare[i]));
  const bw = 32;
  const gap = 18;
  const totalW = years.length * (bw + gap) - gap;
  return (
    <svg width="100%" height={height + 30} viewBox={`0 0 ${totalW + 40} ${height + 30}`} preserveAspectRatio="xMidYMid meet">
      {[0.25, 0.5, 0.75].map(p => (
        <line key={p} x1={28} x2={totalW + 30} y1={height - p*height} y2={height - p*height} stroke="var(--line)" strokeDasharray="2 3"/>
      ))}
      {years.map((y, i) => {
        const ph = (pump[i]/max) * height;
        const sh = (spare[i]/max) * height;
        const x = 30 + i * (bw + gap);
        return (
          <g key={y}>
            <rect x={x} y={height - ph - sh} width={bw} height={sh} fill="oklch(0.78 0.10 55)"/>
            <rect x={x} y={height - ph} width={bw} height={ph} fill="var(--accent)"/>
            <text x={x + bw/2} y={height - ph - sh - 4} textAnchor="middle" fontSize="9" fill="var(--fg-2)" fontFamily="var(--font-mono)">
              {(pump[i] + spare[i]).toFixed(1)}
            </text>
            <text x={x + bw/2} y={height + 12} textAnchor="middle" fontSize="10" fill="var(--fg-3)" fontFamily="var(--font-mono)">FY {y}</text>
          </g>
        );
      })}
      <g transform={`translate(${totalW - 80}, ${height + 22})`}>
        <rect width="9" height="9" fill="var(--accent)"/><text x="14" y="8" fontSize="10" fill="var(--fg-2)">Pump</text>
        <rect width="9" height="9" fill="oklch(0.78 0.10 55)" x="60"/><text x="74" y="8" fontSize="10" fill="var(--fg-2)">Spare</text>
      </g>
    </svg>
  );
}

function VisitTimelineRow({ date, who, purpose, outcome, notes, gps }) {
  const oc = { 'Very Positive': 'pos', 'Positive': 'pos', 'Neutral': null, 'Needs Attention': 'warn', 'Escalation Required': 'neg' };
  return (
    <div className="row-data" style={{ alignItems: 'flex-start', padding: '14px' }}>
      <div style={{ width: 90, flexShrink: 0 }}>
        <div className="num" style={{ fontSize: 12, fontWeight: 500 }}>{date}</div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>{who}</div>
      </div>
      <div className="grow">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontWeight: 500, fontSize: 12 }}>{purpose}</span>
          <Tag kind={oc[outcome]} dot>{outcome}</Tag>
          {gps && <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>✓ {gps}</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5 }}>{notes}</div>
      </div>
    </div>
  );
}

function ContactRow({ name, role, primary, phone, mail }) {
  return (
    <div className="row-data">
      <div className="grow">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 500, fontSize: 12 }}>{name}</span>
          {primary && <Tag kind="accent">PRIMARY</Tag>}
        </div>
        <div className="s" style={{ fontSize: 11 }}>{role}</div>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>{phone}  ·  {mail}</div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="btn sm ghost" style={{ padding: 5 }}><Ic.phone size={12}/></button>
        <button className="btn sm ghost" style={{ padding: 5 }}><Ic.wa size={12}/></button>
        <button className="btn sm ghost" style={{ padding: 5 }}><Ic.mail size={12}/></button>
      </div>
    </div>
  );
}

function PipelineMini({ id, product, stage, value, prob, eta }) {
  return (
    <div className="row-data">
      <div className="grow">
        <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{id}</div>
        <div style={{ fontWeight: 500, fontSize: 12, margin: '2px 0' }}>{product}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Tag dot>{stage}</Tag>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{prob}% · {eta}</span>
        </div>
      </div>
      <div className="num" style={{ fontSize: 14, fontWeight: 500 }}>₹{value} Cr</div>
    </div>
  );
}

function AuditRow({ who, t, what }) {
  return (
    <div className="row-data" style={{ padding: '8px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', width: 50, fontFamily: 'var(--font-mono)' }}>{t}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', width: 40 }}>{who}</div>
      <div className="grow" style={{ fontSize: 11 }}>{what}</div>
    </div>
  );
}

window.ClientProfile = ClientProfile;
