// desktop-screens.jsx — desktop application screens
// Each screen is a full app-shell at 1440×900.

const D = window;
const { Ic, Sidebar, Topbar, Sparkline, MiniBars, Donut, StatusDot, Tag, Photo } = window;

// ─────────────────────────────────────────────────────────────
// EXECUTIVE DASHBOARD
// ─────────────────────────────────────────────────────────────
function ExecDashboard() {
  const user = { name: 'Anjali Mehrotra', role: 'National Sales Head', initials: 'AM' };
  const revYears = [142.4, 168.2, 191.6, 214.8, 248.6];
  const revLabels = ['FY21', 'FY22', 'FY23', 'FY24', 'FY25'];
  const annTarget = 320;
  const annBooked = 178.6;
  return (
    <div className="ris-root app-shell">
      <Sidebar active="dash" role="exec" user={user} alerts={{compete: 4}}/>
      <div className="main">
        <Topbar crumbs={['Risansi', 'Executive Dashboard']} primaryAction="New Report"/>
        <div className="page">
          <div className="page-head">
            <div>
              <div className="page-title">Good morning, Anjali.</div>
              <div className="page-sub">Friday, 16 May 2026 · FY 25–26 closes in 320 days · 6 reps active across 4 zones today</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn"><Ic.download size={12}/>Export PDF</button>
              <button className="btn"><Ic.refresh size={12}/>Refresh</button>
            </div>
          </div>

          {/* Hero metrics row */}
          <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="panel">
              <div className="panel-h">
                <span className="t">FY 25–26 Booked Revenue</span>
                <span className="meta">Updated 14:32 IST</span>
                <div className="right"><Tag kind="pos" dot>On Track</Tag></div>
              </div>
              <div className="panel-b">
                <div style={{ display: 'flex', gap: 32, alignItems: 'flex-end' }}>
                  <div className="metric" style={{ flex: '0 0 auto' }}>
                    <div className="label">Total Booked</div>
                    <div className="val">₹{annBooked}<span className="unit">Cr</span></div>
                    <div className="delta pos">▲ ₹38.4 Cr vs PY · +27.4%</div>
                  </div>
                  <div className="metric" style={{ flex: '0 0 auto' }}>
                    <div className="label">Annual Target</div>
                    <div className="val">₹{annTarget}<span className="unit">Cr</span></div>
                    <div className="target">{((annBooked/annTarget)*100).toFixed(1)}% achieved · 56% YTD</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <MiniBars values={revYears} labels={revLabels} width={280} height={70} target={null}/>
                  </div>
                </div>
                <div className="bar" style={{ marginTop: 14, height: 6 }}>
                  <div className="fill" style={{ width: `${(annBooked/annTarget)*100}%` }}/>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                  <span>0</span><span style={{ color: 'var(--accent)' }}>↑ ₹178.6 Cr</span><span>₹{annTarget} Cr</span>
                </div>
              </div>
            </div>
            <SmallMetric label="Pipeline" value="218" unit="Cr" delta="+12.4%" deltaPos sub="11 in negotiation"
              spark={[140, 158, 162, 184, 198, 211, 218]}/>
            <SmallMetric label="Market Share · PCP" value="38.4" unit="%" delta="+2.1pp YoY" deltaPos sub="National installed base"
              spark={[34, 35, 35.5, 36.4, 37.1, 38.0, 38.4]}/>
            <SmallMetric label="At-Risk Accounts" value="23" delta="₹47 Cr exposure" deltaPos={false} sub="No order > 18 months"
              spark={[18, 19, 20, 22, 22, 23, 23]}/>
          </div>

          {/* Mid row: segment mix + competitive + funnel */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1.5fr', gap: 14, marginBottom: 14 }}>
            <div className="panel">
              <div className="panel-h"><span className="t">Revenue Mix · FY 25–26</span></div>
              <div className="panel-b">
                <SegmentBar label="Sugar" value={104.2} total={annBooked} color="var(--accent)"/>
                <SegmentBar label="Distillery" value={42.8} total={annBooked} color="oklch(0.55 0.13 35)"/>
                <SegmentBar label="Paper" value={11.4} total={annBooked} color="oklch(0.55 0.10 110)"/>
                <SegmentBar label="Dairy" value={9.6} total={annBooked} color="oklch(0.55 0.11 155)"/>
                <SegmentBar label="ETP/Effluent" value={6.2} total={annBooked} color="oklch(0.5 0.09 220)"/>
                <SegmentBar label="Other (4)" value={4.4} total={annBooked} color="var(--fg-3)"/>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Domestic</div>
                    <div className="num" style={{ fontSize: 15, marginTop: 2 }}>₹161.8 Cr</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Export</div>
                    <div className="num" style={{ fontSize: 15, marginTop: 2 }}>₹16.8 Cr</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Pump : Spare</div>
                    <div className="num" style={{ fontSize: 15, marginTop: 2 }}>74 : 26</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-h">
                <span className="t">PCP Market Share · National</span>
                <span className="meta">3,343 units in installed base</span>
                <div className="right"><Tag kind="info">Live from field</Tag></div>
              </div>
              <div className="panel-b" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <Donut data={RIS.shareData} size={140} thick={20} center={
                  <>
                    <div className="num" style={{ fontSize: 22, fontWeight: 500 }}>38.4%</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>RIL Share</div>
                  </>
                }/>
                <div style={{ flex: 1 }}>
                  {RIS.shareData.map((d, i) => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 11 }}>
                      <span style={{ width: 8, height: 8, background: d.color, borderRadius: 2 }}/>
                      <span style={{ flex: 1, fontWeight: i === 0 ? 500 : 400 }}>{d.name}</span>
                      <span className="num" style={{ width: 44, textAlign: 'right' }}>{d.pct.toFixed(1)}%</span>
                      <span className="num" style={{ width: 50, textAlign: 'right', fontSize: 10, color: d.delta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                        {d.delta > 0 ? '+' : ''}{d.delta.toFixed(1)}pp
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-h">
                <span className="t">Pipeline Funnel · FY 25–26</span>
                <div className="right"><Tag>₹655 Cr open</Tag></div>
              </div>
              <div className="panel-b" style={{ padding: '8px 14px' }}>
                {RIS.funnel.map((s, i) => {
                  const maxV = Math.max(...RIS.funnel.map(x => x.value));
                  return (
                    <div key={s.stage} className="funnel-row">
                      <div className="stage" style={{ color: s.color }}>{s.stage}</div>
                      <div className="barwrap">
                        <div style={{ height: 18, background: 'var(--bg-sunk)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${(s.value/maxV)*100}%`, height: '100%', background: s.color, opacity: 0.85, display: 'flex', alignItems: 'center', paddingLeft: 8, color: '#fff', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                            {s.count} opps
                          </div>
                        </div>
                      </div>
                      <div className="v">₹{s.value.toFixed(1)} Cr</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Bottom: Top accounts + Activity */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>
            <div className="panel">
              <div className="panel-h">
                <span className="t">Top Accounts · YTD Revenue</span>
                <div className="right">
                  <button className="btn sm ghost"><Ic.filter size={11}/>All zones</button>
                  <button className="btn sm ghost">Sort: Revenue ▾</button>
                </div>
              </div>
              <div className="panel-b dense">
                <table className="tbl">
                  <thead><tr>
                    <th>Account</th><th>Industry</th><th>Zone</th><th className="right">YTD Rev</th><th className="right">vs PY</th><th>5-yr trend</th><th>Status</th>
                  </tr></thead>
                  <tbody>
                    <TopRow code="MUZF01A001" name="Bajaj Gangnauli" sub="Bajaj Hindusthan · 11,000 TCD" industry="Sugar" zone="U.P. East" ytd={18.4} delta={-12.4} trend={[24.2,31.4,28.7,41.6,18.4]} status="active"/>
                    <TopRow code="BELG01A007" name="Renuka Munoli" sub="Shree Renuka · 320 KLPD" industry="Sugar+Dist" zone="Karnataka" ytd={14.6} delta={+8.2} trend={[16.8,19.2,24.7,32.0,14.6]} status="active"/>
                    <TopRow code="HOSH01A001" name="Balrampur Hoshiarpur" sub="Balrampur Chini · 7,500 TCD" industry="Sugar" zone="U.P. East" ytd={11.4} delta={+3.2} trend={[18.6,22.1,26.8,30.2,11.4]} status="active"/>
                    <TopRow code="KOLH02A004" name="Dalmia Kolhapur" sub="Dalmia Bharat · 220 KLPD" industry="Distillery" zone="West" ytd={7.2} delta={-1.8} trend={[12.4,14.9,22.5,28.1,7.2]} status="active"/>
                    <TopRow code="INDR01A003" name="Praj Indore" sub="Praj OEM · 90 KLPD" industry="Distillery" zone="Central" ytd={9.1} delta={+24.6} trend={[4.2,8.1,12.4,18.9,9.1]} status="active"/>
                    <TopRow code="AHMD01A005" name="Sabar Dairy" sub="GCMMF · Himmatnagar" industry="Dairy" zone="West" ytd={6.4} delta={+1.1} trend={[6.4,8.8,11.2,14.6,6.4]} status="active"/>
                    <TopRow code="EXPT01A002" name="Madhvani Kakira" sub="Export · Uganda · 9,200 TCD" industry="Sugar" zone="Export" ytd={4.2} delta={-2.4} trend={[9.2,11.6,14.8,17.2,4.2]} status="active"/>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h">
                <span className="t">Live Field Activity</span>
                <div className="right"><span className="live-dot"/><span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>real-time</span></div>
              </div>
              <div className="panel-b" style={{ padding: 0 }}>
                {RIS.visitFeed.map(a => (
                  <div key={a.id} className="row-data">
                    <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--bg-sunk)', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 600, color: 'var(--fg-2)', flexShrink: 0 }}>
                      {a.initials}
                    </div>
                    <div className="grow">
                      <div style={{ fontSize: 12 }}>
                        <strong style={{ fontWeight: 500 }}>{a.who}</strong>{' '}
                        <span style={{ color: 'var(--fg-3)' }}>{a.what}</span>{' '}
                        <span style={{ fontWeight: 500 }}>{a.client}</span>
                      </div>
                      {a.outcome && <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 2 }}><Tag kind={a.outcome.includes('Positive') ? 'pos' : 'warn'}>{a.outcome}</Tag></div>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                      <div>{a.when}</div>
                      <div style={{ color: a.sync === 'queued' ? 'var(--warn)' : 'var(--pos)' }}>● {a.sync}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SmallMetric({ label, value, unit, delta, deltaPos, sub, spark }) {
  return (
    <div className="panel">
      <div className="panel-b" style={{ padding: 14 }}>
        <div className="metric">
          <div className="label">{label}</div>
          <div className="val">{value}{unit && <span className="unit">{unit}</span>}</div>
          <div className={`delta ${deltaPos ? 'pos' : 'neg'}`}>{deltaPos ? '▲' : '▼'} {delta}</div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{sub}</div>
          {spark && <Sparkline values={spark} width={70} height={22} color={deltaPos ? 'var(--pos)' : 'var(--neg)'}/>}
        </div>
      </div>
    </div>
  );
}

function SegmentBar({ label, value, total, color }) {
  const pct = (value / total) * 100;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
        <span>{label}</span>
        <span className="num" style={{ color: 'var(--fg-2)' }}>₹{value.toFixed(1)} Cr <span style={{ color: 'var(--fg-3)' }}>({pct.toFixed(0)}%)</span></span>
      </div>
      <div className="bar"><div className="fill" style={{ width: `${pct}%`, background: color }}/></div>
    </div>
  );
}

function TopRow({ code, name, sub, industry, zone, ytd, delta, trend, status }) {
  return (
    <tr>
      <td>
        <div className="name">{name}</div>
        <div className="sub code">{code} · {sub}</div>
      </td>
      <td><Tag>{industry}</Tag></td>
      <td className="muted">{zone}</td>
      <td className="right num">₹{ytd} Cr</td>
      <td className="right num" style={{ color: delta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{delta > 0 ? '+' : ''}{delta}%</td>
      <td><Sparkline values={trend} width={70} height={20} color="var(--accent)"/></td>
      <td><Tag kind="pos" dot>{status}</Tag></td>
    </tr>
  );
}

window.ExecDashboard = ExecDashboard;
