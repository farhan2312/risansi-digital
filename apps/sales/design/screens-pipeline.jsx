// screens-pipeline.jsx — Pipeline kanban + Revenue tracker + Compete intel + Visit calendar + Admin

const { Ic, Sidebar, Topbar, Sparkline, MiniBars, Donut, StatusDot, Tag, Photo, CoverageMap } = window;

// ─────────────────────────────────────────────────────────────
// PIPELINE & REVENUE
// ─────────────────────────────────────────────────────────────
function PipelineRevenue() {
  const user = { name: 'Anjali Mehrotra', role: 'National Sales Head', initials: 'AM' };
  const stages = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'Won', 'Lost'];
  return (
    <div className="ris-root app-shell">
      <Sidebar active="pipeline" role="exec" user={user}/>
      <div className="main">
        <Topbar crumbs={['Pipeline & Revenue']} primaryAction="New Opportunity"/>
        <div className="page">
          <div className="page-head">
            <div>
              <div className="page-title">Pipeline & Revenue</div>
              <div className="page-sub">112 open opportunities · ₹655 Cr open value · weighted forecast ₹248 Cr · win rate FY 73%</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="tabs" style={{ border: 0 }}>
                <span className="tab is-active">Pipeline</span>
                <span className="tab">Revenue Ledger</span>
                <span className="tab">Win / Loss</span>
                <span className="tab">Forecast</span>
              </div>
              <button className="btn"><Ic.filter size={12}/>All zones</button>
              <button className="btn"><Ic.kanban size={12}/>Kanban</button>
            </div>
          </div>

          {/* Forecast strip */}
          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-b" style={{ padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 2fr', gap: 24, alignItems: 'center' }}>
                <ForecastBlock label="Booked (Won YTD)" value="178.6" sub="38 closed orders" color="var(--pos)"/>
                <ForecastBlock label="Best-case (100% pipe)" value="833.6" sub="178 + 655 open" color="var(--fg)"/>
                <ForecastBlock label="Probability-weighted" value="427.4" sub="248 weighted + 178" color="var(--accent)" highlight/>
                <ForecastBlock label="Annual Target" value="320.0" sub="₹141 Cr to go" color="var(--fg-2)"/>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-3)', marginBottom: 6 }}>
                    <span>Target ₹320 Cr</span>
                    <span className="num" style={{ color: 'var(--accent)' }}>Weighted 134%</span>
                  </div>
                  <ForecastBar booked={178.6} weighted={248.8} target={320}/>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-3)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                    <span>● booked</span><span style={{ color: 'var(--accent)' }}>● weighted pipe</span><span style={{ color: 'var(--fg-3)' }}>target line</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Kanban */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 14 }}>
            {stages.map(s => {
              const items = RIS.pipeline.filter(p => p.stage === s);
              const totalVal = items.reduce((a, b) => a + b.value, 0);
              const colors = { Suspect: 'var(--info)', Prospect: '#5a86c2', Quoted: '#c69347', Negotiating: 'var(--accent)', Won: 'var(--pos)', Lost: 'var(--neg)' };
              return (
                <div key={s} style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 6, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: colors[s], textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s}</span>
                      <span className="num" style={{ fontSize: 11, color: 'var(--fg-3)' }}>{items.length}</span>
                    </div>
                    <span className="num" style={{ fontSize: 13, color: 'var(--fg)' }}>₹{totalVal.toFixed(1)} Cr</span>
                  </div>
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {items.map(p => <OppCard key={p.id} p={p}/>)}
                    {items.length === 0 && <div style={{ fontSize: 10, color: 'var(--fg-3)', textAlign: 'center', padding: 20 }}>No opps</div>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom: opps list + win-loss */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
            <div className="panel">
              <div className="panel-h">
                <span className="t">Active Opportunities · sorted by value</span>
                <span className="meta">10 of 112 shown</span>
                <div className="right"><button className="btn sm ghost">Export</button></div>
              </div>
              <div className="panel-b dense">
                <table className="tbl">
                  <thead><tr><th>Opp</th><th>Client</th><th>Product</th><th>Stage</th><th className="right">Value</th><th className="center">Prob</th><th>ETA</th><th>Rep</th></tr></thead>
                  <tbody>
                    {RIS.pipeline.map(p => (
                      <tr key={p.id}>
                        <td className="code">{p.id}</td>
                        <td><div className="name">{p.client}</div><div className="sub code">{p.code}</div></td>
                        <td style={{ fontSize: 11 }}>{p.product}</td>
                        <td><Tag dot>{p.stage}</Tag></td>
                        <td className="right num">₹{p.value} Cr</td>
                        <td className="center"><span className="num">{p.prob}%</span></td>
                        <td className="muted num" style={{ fontSize: 11 }}>{p.eta}</td>
                        <td className="muted" style={{ fontSize: 11 }}>{RIS.repById(p.rep)?.initials}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
              <div className="panel">
                <div className="panel-h"><span className="t">Win Rate · last 12 months</span></div>
                <div className="panel-b">
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                    <div className="num" style={{ fontSize: 32 }}>73%</div>
                    <div style={{ fontSize: 11, color: 'var(--pos)' }}>▲ +6pp YoY</div>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    {[
                      ['Sugar', 79, 'var(--accent)'],
                      ['Distillery', 71, 'oklch(0.55 0.13 35)'],
                      ['Paper', 64, 'oklch(0.55 0.10 110)'],
                      ['Dairy', 82, 'oklch(0.55 0.11 155)'],
                    ].map(([k, v, c]) => (
                      <div key={k} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                          <span>{k}</span><span className="num">{v}%</span>
                        </div>
                        <div className="bar"><div className="fill" style={{ width: `${v}%`, background: c }}/></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="panel">
                <div className="panel-h"><span className="t">Lost To · top reasons</span></div>
                <div className="panel-b" style={{ padding: 0 }}>
                  {[
                    ['Roto', 6, 38.4, 'Price-undercut on standard PCP'],
                    ['Netzsch', 4, 24.8, 'Higher-spec model preferred'],
                    ['Tushaco', 2, 12.2, 'Existing relationship leveraged'],
                    ['Others', 2, 8.8, 'Project deferred / cancelled'],
                  ].map(([n, ct, v, why]) => (
                    <div key={n} className="row-data">
                      <div className="grow">
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{n}</div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)' }}>{why}</div>
                      </div>
                      <div className="num" style={{ fontSize: 11 }}>{ct} opps · ₹{v} Cr</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ForecastBlock({ label, value, sub, color, highlight }) {
  return (
    <div style={highlight ? { padding: 12, background: 'var(--accent-soft)', borderRadius: 6, border: `1px solid var(--accent-line)` } : {}}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div className="num" style={{ fontSize: 22, marginTop: 2, color, lineHeight: 1.1 }}>₹{value}<span style={{ fontSize: 12, color: 'var(--fg-3)', marginLeft: 4 }}>Cr</span></div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{sub}</div>
    </div>
  );
}

function ForecastBar({ booked, weighted, target }) {
  const tot = Math.max(target, weighted) * 1.05;
  return (
    <div style={{ height: 22, background: 'var(--bg-sunk)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(booked/tot)*100}%`, background: 'var(--pos)' }}/>
      <div style={{ position: 'absolute', left: `${(booked/tot)*100}%`, top: 0, bottom: 0, width: `${((weighted - booked)/tot)*100}%`, background: 'var(--accent)', opacity: 0.85 }}/>
      <div style={{ position: 'absolute', left: `${(target/tot)*100}%`, top: -2, bottom: -2, width: 2, background: 'var(--bg-ink)' }}/>
    </div>
  );
}

function OppCard({ p }) {
  const colors = { Suspect: 'var(--info)', Prospect: '#5a86c2', Quoted: '#c69347', Negotiating: 'var(--accent)', Won: 'var(--pos)', Lost: 'var(--neg)' };
  return (
    <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderLeft: `2px solid ${colors[p.stage]}`, borderRadius: 4, padding: 10 }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', display: 'flex', justifyContent: 'space-between' }}>
        <span>{p.id}</span><span>{RIS.repById(p.rep)?.initials}</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, margin: '4px 0', lineHeight: 1.3 }}>{p.client}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 6 }}>{p.product}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="num" style={{ fontSize: 13, fontWeight: 500 }}>₹{p.value} Cr</span>
        <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>{p.prob}% · {p.eta}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPETITIVE INTELLIGENCE
// ─────────────────────────────────────────────────────────────
function CompeteIntel() {
  const user = { name: 'Anjali Mehrotra', role: 'National Sales Head', initials: 'AM' };
  return (
    <div className="ris-root app-shell">
      <Sidebar active="compete" role="exec" user={user} alerts={{compete: 4}}/>
      <div className="main">
        <Topbar crumbs={['Competitive Intelligence', 'National']}/>
        <div className="page">
          <div className="page-head">
            <div>
              <div className="page-title">Competitive Intelligence</div>
              <div className="page-sub">3,343 pumps assessed across 487 active accounts · 78% coverage (12-mo) · last sync 14:32</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn"><Ic.target size={12}/>Displacement List</button>
              <button className="btn"><Ic.layers size={12}/>Trend Analysis</button>
            </div>
          </div>

          {/* Top: PCP / MMP share */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
            <ShareCard title="PCP · National Share" total="3,343 units" share="38.4%" delta="+2.1pp YoY"
              data={RIS.shareData}/>
            <ShareCard title="MMP · National Share" total="1,182 units" share="29.7%" delta="+1.4pp YoY"
              data={[
                { name: 'RIL', pct: 29.7, units: 351, delta: +1.4, color: 'var(--accent)' },
                { name: 'Tushaco', pct: 18.4, units: 217, delta: -0.8, color: '#3a3a3a' },
                { name: 'KSB', pct: 14.2, units: 168, delta: +0.2, color: '#5a5a5a' },
                { name: 'Mahalaxmi', pct: 11.2, units: 132, delta: -0.4, color: '#7a7a7a' },
                { name: 'Sintech', pct: 8.6, units: 102, delta: +0.6, color: '#8a8a8a' },
                { name: 'Other (9)', pct: 17.9, units: 212, delta: -1.0, color: '#aaaaaa' },
              ]}/>
            <div className="panel">
              <div className="panel-h"><span className="t">Share Evolution · 24 months</span></div>
              <div className="panel-b">
                <ShareEvolution/>
              </div>
            </div>
          </div>

          {/* Displacement opportunities */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>
            <div className="panel">
              <div className="panel-h">
                <span className="t">Displacement Opportunities · End-of-Life Competitor Pumps</span>
                <span className="meta">Auto-generated from field assessments</span>
                <div className="right"><Tag kind="accent">142 units · ₹64 Cr est.</Tag></div>
              </div>
              <div className="panel-b dense">
                <table className="tbl">
                  <thead><tr><th>Client</th><th>Station</th><th>Pump</th><th className="center">Qty</th><th>Flagged</th><th className="right">Est. Replace</th><th></th></tr></thead>
                  <tbody>
                    <DispRow client="Dalmia Kolhapur" code="KOLH02A004" station="Distillery Spent Wash" pump="Netzsch NE-200 PCP" qty={2} when="14 Feb 2026" est={4.8} hot/>
                    <DispRow client="Dalmia Kolhapur" code="KOLH02A004" station="Effluent (ETP)" pump="Gita G-90 PCP" qty={3} when="14 Feb 2026" est={3.6} hot/>
                    <DispRow client="Bajaj Gangnauli" code="MUZF01A001" station="Cane Prep" pump="Roto R-180 PCP" qty={4} when="08 May 2026" est={9.2} hot/>
                    <DispRow client="Balrampur Hoshiarpur" code="HOSH01A001" station="Juice Sulphitation" pump="Rotomac RM-120" qty={2} when="22 Apr 2026" est={3.4}/>
                    <DispRow client="Renuka Munoli" code="BELG01A007" station="Boiler Feed (MMP)" pump="Tushaco TS-300" qty={3} when="19 Mar 2026" est={5.6}/>
                    <DispRow client="Sabar Dairy" code="AHMD01A005" station="Milk Reception" pump="Sintech ST-60" qty={2} when="12 Apr 2026" est={2.4}/>
                    <DispRow client="Praj Indore" code="INDR01A003" station="Fermentation" pump="Mahalaxmi M-110" qty={2} when="30 Apr 2026" est={2.8}/>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><span className="t">Competitor Activity Feed</span></div>
              <div className="panel-b" style={{ padding: 0 }}>
                <CompetitorActivity who="Netzsch" type="Quote observed" at="Praj Indore" by="HT" when="1 hr ago" sev="warn" detail="Quoted ₹2.4 Cr for PCP MX equivalent, 8% below our pricing"/>
                <CompetitorActivity who="Roto" type="New installation" at="Mumbai Sugar Co." by="MJ" when="yesterday" sev="warn" detail="3× R-180 installed at cane prep stage"/>
                <CompetitorActivity who="Tushaco" type="Rep visit observed" at="Renuka Munoli" by="SI" when="2d ago" sev="info" detail="Tushaco regional manager toured plant on 14 May"/>
                <CompetitorActivity who="Sintech" type="Price undercutting" at="Bagpat Co-op" by="RY" when="3d ago" sev="neg" detail="Verbal quote at 22% under RIL benchmark"/>
                <CompetitorActivity who="Mahalaxmi" type="Complaint resolved" at="Vidisha Sugar" by="RA" when="4d ago" sev="warn" detail="Replaced failed unit free of charge"/>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShareCard({ title, total, share, delta, data }) {
  return (
    <div className="panel">
      <div className="panel-h"><span className="t">{title}</span><span className="meta">{total}</span></div>
      <div className="panel-b" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Donut data={data} size={120} thick={18} center={
          <>
            <div className="num" style={{ fontSize: 18, fontWeight: 500 }}>{share}</div>
            <div style={{ fontSize: 9, color: 'var(--pos)' }}>{delta}</div>
          </>
        }/>
        <div style={{ flex: 1 }}>
          {data.map((d, i) => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontSize: 10 }}>
              <span style={{ width: 6, height: 6, background: d.color, borderRadius: 1 }}/>
              <span style={{ flex: 1, fontWeight: i === 0 ? 500 : 400 }}>{d.name}</span>
              <span className="num">{d.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShareEvolution() {
  const months = 12;
  const series = {
    RIL: [34, 34.4, 34.8, 35.2, 35.6, 36.1, 36.4, 36.8, 37.1, 37.5, 38.0, 38.4],
    Roto: [18.4, 18.2, 17.9, 17.6, 17.4, 17.0, 16.8, 16.6, 16.4, 16.4, 16.3, 16.2],
    Netzsch: [10.2, 10.4, 10.6, 10.8, 11.0, 11.2, 11.4, 11.4, 11.5, 11.6, 11.7, 11.8],
    Tushaco: [10.8, 10.6, 10.4, 10.2, 10.0, 9.8, 9.7, 9.6, 9.5, 9.5, 9.4, 9.4],
  };
  const colors = { RIL: 'var(--accent)', Roto: '#3a3a3a', Netzsch: '#5a86c2', Tushaco: '#8a6a4a' };
  const W = 280, H = 110, pad = 20;
  const max = 42, min = 6;
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`}>
        {[10, 20, 30, 40].map(g => {
          const y = H - ((g - min)/(max-min)) * (H - pad);
          return <g key={g}><line x1={20} x2={W} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 2"/><text x={4} y={y+3} fontSize="8" fill="var(--fg-3)" fontFamily="var(--font-mono)">{g}%</text></g>;
        })}
        {Object.entries(series).map(([name, vals]) => {
          const step = (W - 24)/(months - 1);
          const pts = vals.map((v, i) => `${20 + i*step},${H - ((v - min)/(max-min))*(H - pad)}`);
          return <path key={name} d={`M ${pts.join(' L ')}`} stroke={colors[name]} strokeWidth={name === 'RIL' ? 2 : 1.2} fill="none"/>;
        })}
      </svg>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
        {Object.entries(colors).map(([n, c]) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
            <span style={{ width: 12, height: 2, background: c }}/><span>{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DispRow({ client, code, station, pump, qty, when, est, hot }) {
  return (
    <tr style={hot ? { background: 'oklch(0.97 0.04 50)' } : {}}>
      <td><div className="name">{client}</div><div className="sub code">{code}</div></td>
      <td style={{ fontSize: 11 }}>{station}</td>
      <td style={{ fontSize: 11 }}>{pump}</td>
      <td className="center num">{qty}</td>
      <td className="muted num" style={{ fontSize: 11 }}>{when}</td>
      <td className="right num">₹{est} Cr</td>
      <td>{hot ? <Tag kind="accent">HOT</Tag> : <button className="btn sm ghost">Assign</button>}</td>
    </tr>
  );
}

function CompetitorActivity({ who, type, at, by, when, sev, detail }) {
  return (
    <div className="row-data" style={{ alignItems: 'flex-start' }}>
      <Tag kind={sev}>{who}</Tag>
      <div className="grow">
        <div style={{ fontSize: 12, fontWeight: 500 }}>{type} <span style={{ color: 'var(--fg-3)', fontWeight: 400 }}>· {at}</span></div>
        <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 3 }}>{detail}</div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>{by} · {when}</div>
      </div>
    </div>
  );
}

window.PipelineRevenue = PipelineRevenue;
window.CompeteIntel = CompeteIntel;
