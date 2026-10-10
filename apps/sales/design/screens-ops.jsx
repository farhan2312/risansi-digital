// screens-ops.jsx — Visit Calendar (manager) + Admin (data quality)

const { Ic, Sidebar, Topbar, Tag } = window;

// ─────────────────────────────────────────────────────────────
// VISIT CALENDAR (Manager view)
// ─────────────────────────────────────────────────────────────
function VisitCalendar() {
  const user = { name: 'Himanshu Tiwari', role: 'Zonal Manager · Central', initials: 'HT' };
  const days = ['Mon 11', 'Tue 12', 'Wed 13', 'Thu 14', 'Fri 15', 'Sat 16', 'Sun 17'];
  const reps = [
    { id: 'HT', name: 'Himanshu Tiwari', sub: 'M.P.-2' },
    { id: 'VK', name: 'Vikram Khanna', sub: 'M.P.-1' },
    { id: 'ND', name: 'Nilesh Desai', sub: 'Central-1' },
    { id: 'RA', name: 'Rohit Agarwal', sub: 'Central-2' },
  ];
  // visits keyed by `${rep}-${dayIdx}` -> array of {client, time, status, purpose}
  const visits = {
    'HT-0': [{ c: 'Vippy Industries', t: '10:00', s: 'done', p: 'routine' }],
    'HT-1': [{ c: 'Daawat Foods', t: '11:00', s: 'done', p: 'mgmt' }, { c: 'Cargill Indore', t: '15:00', s: 'done', p: 'quote' }],
    'HT-3': [{ c: 'Praj Indore', t: '09:00', s: 'done', p: 'quote' }],
    'HT-4': [{ c: 'Ujjain Distillery', t: '14:30', s: 'today', p: 'opp' }],
    'HT-5': [{ c: 'Sajjan Mills', t: '10:00', s: 'planned', p: 'routine' }],
    'VK-0': [{ c: 'Mahalaxmi Mill', t: '10:30', s: 'done', p: 'assessment' }],
    'VK-2': [{ c: 'Vippy Industries', t: '14:00', s: 'done', p: 'complaint' }],
    'VK-4': [{ c: 'Ratlam Sugar', t: '11:00', s: 'today', p: 'routine' }],
    'VK-5': [{ c: 'Sehore Mill', t: '09:30', s: 'planned', p: 'routine' }, { c: 'Indore Paper', t: '13:00', s: 'planned', p: 'opp' }],
    'ND-1': [{ c: 'Sagar Sugar', t: '11:00', s: 'done', p: 'routine' }],
    'ND-3': [{ c: 'Sagar Pulp', t: '10:00', s: 'done', p: 'assessment' }],
    'ND-4': [{ c: 'Daawat Foods', t: '11:20', s: 'today', p: 'complaint' }],
    'ND-5': [{ c: 'Bina Mill', t: '16:00', s: 'planned', p: 'routine' }],
    'RA-2': [{ c: 'Vidisha Sugar', t: '14:00', s: 'missed', p: 'mgmt' }],
    'RA-4': [{ c: 'Vidisha Co-op', t: '17:00', s: 'today', p: 'mgmt', warn: true }],
  };
  const purposeColors = {
    routine: 'var(--fg-3)', quote: 'var(--accent)', mgmt: '#5a86c2',
    opp: 'oklch(0.55 0.13 35)', complaint: 'var(--neg)', assessment: 'var(--pos)',
  };
  const statusBg = {
    done: 'var(--bg-elev)', today: 'var(--accent-soft)', planned: 'var(--bg-paper)',
    missed: 'var(--neg-soft)',
  };

  return (
    <div className="ris-root app-shell">
      <Sidebar active="visits" role="manager" user={user}/>
      <div className="main">
        <Topbar crumbs={['Visit Plan', 'Central Zone', 'Week 20']} primaryAction="Plan visit"/>
        <div className="page">
          <div className="page-head">
            <div>
              <div className="page-title">Week 20 · 11–17 May 2026</div>
              <div className="page-sub">12 planned · 9 completed · 1 missed · 75% week-to-date compliance</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="tabs" style={{ border: 0 }}>
                <span className="tab">Day</span>
                <span className="tab is-active">Week</span>
                <span className="tab">Month</span>
              </div>
              <button className="btn"><Ic.chevLeft size={12}/></button>
              <button className="btn"><Ic.chevRight size={12}/></button>
              <button className="btn"><Ic.filter size={12}/>All routes</button>
            </div>
          </div>

          {/* Calendar grid */}
          <div className="panel" style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '160px repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
              <div style={{ padding: '10px 14px', fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderRight: '1px solid var(--line)' }}>Rep / Day</div>
              {days.map((d, i) => (
                <div key={d} style={{ padding: '10px 12px', borderRight: i < 6 ? '1px solid var(--line)' : 0, fontSize: 11, background: i === 5 ? 'var(--accent-soft)' : 'transparent' }}>
                  <div style={{ fontWeight: 500, color: i === 5 ? 'var(--accent)' : 'var(--fg)' }}>{d}</div>
                  <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{i === 5 ? 'TODAY' : ''}</div>
                </div>
              ))}
            </div>
            {reps.map(rep => (
              <div key={rep.id} style={{ display: 'grid', gridTemplateColumns: '160px repeat(7, 1fr)', borderBottom: '1px solid var(--line)', minHeight: 86 }}>
                <div style={{ padding: '10px 14px', borderRight: '1px solid var(--line)', background: 'var(--bg-paper)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 22, height: 22, background: 'var(--bg-sunk)', borderRadius: 4, display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 600, color: 'var(--fg-2)' }}>{rep.id}</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{rep.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)' }}>{rep.sub}</div>
                    </div>
                  </div>
                </div>
                {days.map((_, di) => {
                  const v = visits[`${rep.id}-${di}`] || [];
                  return (
                    <div key={di} style={{ padding: 6, borderRight: di < 6 ? '1px solid var(--line)' : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {v.map((vv, i) => (
                        <div key={i} style={{
                          padding: '5px 7px', borderRadius: 4,
                          background: statusBg[vv.s],
                          borderLeft: `2px solid ${purposeColors[vv.p]}`,
                          fontSize: 10,
                          opacity: vv.s === 'planned' ? 0.85 : 1,
                          position: 'relative',
                        }}>
                          <div className="num" style={{ fontSize: 9, color: 'var(--fg-3)' }}>{vv.t}</div>
                          <div style={{ fontSize: 11, fontWeight: 500, marginTop: 1, color: vv.s === 'missed' ? 'var(--neg)' : 'var(--fg)' }}>{vv.c}</div>
                          {vv.warn && <span style={{ position: 'absolute', top: 4, right: 4, color: 'var(--neg)', fontSize: 10 }}>!</span>}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
            {/* Footer legend */}
            <div style={{ padding: '10px 14px', display: 'flex', gap: 18, fontSize: 10, color: 'var(--fg-3)' }}>
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>Purpose:</span>
              {Object.entries(purposeColors).map(([k, v]) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textTransform: 'capitalize' }}>
                  <span style={{ width: 8, height: 8, background: v, borderRadius: 1 }}/>{k}
                </span>
              ))}
            </div>
          </div>

          {/* Overdue + suggested */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="panel">
              <div className="panel-h"><span className="t">Overdue Accounts · need a visit</span><div className="right"><Tag kind="neg">8 in zone</Tag></div></div>
              <div className="panel-b" style={{ padding: 0 }}>
                <OverdueRow name="Vidisha Co-op Sugar" code="VIDS01A001" days={154} tier="Standard" route="Central-2" rep="RA"/>
                <OverdueRow name="Mhow Cattle Feed" code="MHOW01A002" days={211} tier="Standard" route="Central-1" rep="ND"/>
                <OverdueRow name="Bina Pulp & Paper" code="SAGR01A003" days={188} tier="Key" route="Central-2" rep="RA" critical/>
                <OverdueRow name="Sehore Sugar Mills" code="SHOR01A002" days={102} tier="Key" route="M.P.-1" rep="VK"/>
                <OverdueRow name="Bhopal Distillery" code="BHPL02A007" days={94} tier="Key" route="Central-1" rep="ND"/>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><span className="t">Route Suggestions · Tomorrow (Sat 17)</span><div className="right"><Tag kind="info">AI-optimized</Tag></div></div>
              <div className="panel-b" style={{ padding: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 10 }}>VK · Indore loop · 4 visits · 138 km · 8.2 hrs</div>
                <div style={{ position: 'relative', paddingLeft: 18 }}>
                  <div style={{ position: 'absolute', left: 5, top: 8, bottom: 8, width: 1, background: 'var(--line-strong)' }}/>
                  <RouteStop time="08:30" name="Sehore Sugar Mills" sub="40 km from base · Key overdue" first/>
                  <RouteStop time="11:00" name="Indore Paper Co" sub="58 km · new opportunity"/>
                  <RouteStop time="14:30" name="Praj Indore" sub="12 km · quote follow-up"/>
                  <RouteStop time="17:00" name="Cargill Indore" sub="6 km · routine" last/>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <button className="btn sm primary">Assign to VK</button>
                  <button className="btn sm ghost">Modify</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OverdueRow({ name, code, days, tier, route, rep, critical }) {
  return (
    <div className="row-data">
      {critical && <div style={{ width: 3, alignSelf: 'stretch', background: 'var(--neg)' }}/>}
      <div className="grow">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="t">{name}</span>
          <Tag kind={tier === 'Key' ? 'accent' : null}>{tier}</Tag>
        </div>
        <div className="s code">{code} · {route} · assigned to {rep}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="num" style={{ fontSize: 13, color: critical ? 'var(--neg)' : 'var(--warn)', fontWeight: 500 }}>{days}d</div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)' }}>since visit</div>
      </div>
      <button className="btn sm">Schedule</button>
    </div>
  );
}

function RouteStop({ time, name, sub, first, last }) {
  return (
    <div style={{ position: 'relative', paddingBottom: last ? 0 : 14 }}>
      <div style={{ position: 'absolute', left: -16, top: 3, width: 9, height: 9, borderRadius: '50%', background: 'var(--bg-elev)', border: `2px solid ${first ? 'var(--accent)' : 'var(--fg-3)'}` }}/>
      <div className="num" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{time}</div>
      <div style={{ fontSize: 12, fontWeight: 500 }}>{name}</div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)' }}>{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ADMIN — Data Quality & Migration
// ─────────────────────────────────────────────────────────────
function AdminConsole() {
  const user = { name: 'Priya Sharma', role: 'Back-Office Admin', initials: 'PS' };
  return (
    <div className="ris-root app-shell">
      <Sidebar active="admin" role="manager" user={user} alerts={{admin: 12}}/>
      <div className="main">
        <Topbar crumbs={['Admin', 'Data Quality']}/>
        <div className="page">
          <div className="page-head">
            <div>
              <div className="page-title">Data Quality Console</div>
              <div className="page-sub">3,612 client records · 2 migrated batches · 12 items awaiting review · last audit run 03:14 IST</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn"><Ic.download size={12}/>Audit Report</button>
              <button className="btn primary"><Ic.plus size={12}/>New Client</button>
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
            <QualKpi label="Active records" val="3,108" sub="86% of total"/>
            <QualKpi label="Completeness" val="94.2%" sub="≥ 95% target" warn/>
            <QualKpi label="GPS-verified" val="2,847" sub="79% of active"/>
            <QualKpi label="Duplicate flags" val="14" sub="needing review" neg/>
            <QualKpi label="Audit entries" val="48,612" sub="last 30 days"/>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginBottom: 14 }}>
            {/* Issues queue */}
            <div className="panel">
              <div className="panel-h">
                <span className="t">Quality Queue · 12 items</span>
                <div className="right">
                  <button className="btn sm ghost is-active">All</button>
                  <button className="btn sm ghost">Duplicates 4</button>
                  <button className="btn sm ghost">Incomplete 6</button>
                  <button className="btn sm ghost">Conflicts 2</button>
                </div>
              </div>
              <div className="panel-b dense">
                <table className="tbl">
                  <thead><tr><th>Type</th><th>Record</th><th>Issue</th><th>Detected</th><th></th></tr></thead>
                  <tbody>
                    <IssueRow type="dup" record="Bagpat Co-op Sugar Mill" code="BAGT01A002" issue="92% similar to BAGT01A003 (Baghpat Co-op Sugar)" when="2h ago" sev="warn"/>
                    <IssueRow type="conflict" record="Renuka Munoli" code="BELG01A007" issue="Status changed by 2 users in 10 min (Active↔Inactive)" when="3h ago" sev="neg"/>
                    <IssueRow type="incomplete" record="Cargill Bhopal" code="BHPL01A009" issue="Missing GPS, capacity bracket, primary contact" when="5h ago" sev="warn"/>
                    <IssueRow type="dup" record="Dalmia Kolhapur Distillery" code="KOLH02A005" issue="Same address as KOLH02A004 (Dalmia Bharat Sugar)" when="1d ago" sev="warn"/>
                    <IssueRow type="incomplete" record="Reddy Distillery — Nellore" code="NELL01A002" issue="No primary contact flagged; 3 contacts present" when="1d ago"/>
                    <IssueRow type="conflict" record="Praj Indore" code="INDR01A003" issue="Revenue entry awaiting confirmation: ₹0.96 Cr · Mar 2026" when="2d ago" sev="info"/>
                    <IssueRow type="incomplete" record="Sehore Sugar Mills" code="SHOR01A002" issue="No equipment assessment in 24+ months" when="2d ago"/>
                    <IssueRow type="dup" record="Madhvani Kakira" code="EXPT01A002" issue="Possible group-mill duplicate (Madhvani Group: 3 records)" when="3d ago"/>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Migration status */}
            <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
              <div className="panel">
                <div className="panel-h"><span className="t">Excel Migration · Final Status</span><div className="right"><Tag kind="pos">Complete</Tag></div></div>
                <div className="panel-b">
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 8 }}>Source: <span className="code">Master Client Sheet v118.xlsx</span> · imported 14 May 2026</div>
                  <div className="bar" style={{ height: 8, marginBottom: 10 }}>
                    <div className="fill" style={{ width: '99.6%', background: 'var(--pos)' }}/>
                  </div>
                  <table className="tbl" style={{ fontSize: 11 }}>
                    <tbody>
                      <tr><td>Total rows</td><td className="right num">3,612</td></tr>
                      <tr><td>Imported clean</td><td className="right num" style={{ color: 'var(--pos)' }}>3,584</td></tr>
                      <tr><td>Auto-corrected</td><td className="right num" style={{ color: 'var(--info)' }}>24</td></tr>
                      <tr><td>Manual review</td><td className="right num" style={{ color: 'var(--warn)' }}>4</td></tr>
                      <tr><td>Failed</td><td className="right num" style={{ color: 'var(--neg)' }}>0</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel">
                <div className="panel-h"><span className="t">Recent Field Changes</span></div>
                <div className="panel-b" style={{ padding: 0 }}>
                  <FieldChangeRow t="14:18" who="HT" what="Status: Standard → Key" record="Praj Indore"/>
                  <FieldChangeRow t="13:55" who="AP" what="Added contact: Mr Patil" record="Dalmia Kolhapur"/>
                  <FieldChangeRow t="13:42" who="RY" what="Submitted visit (12 fields)" record="Bajaj Gangnauli"/>
                  <FieldChangeRow t="12:30" who="System" what="Locked revenue entry RV-4421" record="Sabar Dairy"/>
                  <FieldChangeRow t="11:08" who="Admin" what="Created client record" record="JK Pulp & Paper"/>
                </div>
              </div>
            </div>
          </div>

          {/* User access matrix */}
          <div className="panel">
            <div className="panel-h"><span className="t">User & Role Matrix</span><div className="right"><Tag>18 users · 5 roles</Tag><button className="btn sm">Manage</button></div></div>
            <div className="panel-b dense">
              <table className="tbl">
                <thead><tr><th>User</th><th>Role</th><th>Zone / Route</th><th className="center">MFA</th><th className="center">Sessions (30d)</th><th className="center">Last Login</th><th></th></tr></thead>
                <tbody>
                  <UserRow name="Anjali Mehrotra" role="National Sales Head" zone="All India" mfa sess={42} last="14:32"/>
                  <UserRow name="Himanshu Tiwari" role="Zonal Manager" zone="Central · 4 reps" mfa sess={38} last="14:24"/>
                  <UserRow name="Mahesh Joshi" role="Zonal Manager" zone="West · 2 reps" mfa sess={34} last="13:50"/>
                  <UserRow name="Akshay Pawar" role="Field Sales Rep" zone="Satara-1" mfa={false} sess={62} last="13:08"/>
                  <UserRow name="Rakesh Yadav" role="Field Sales Rep" zone="U.P. East" mfa={false} sess={58} last="13:51"/>
                  <UserRow name="Sandeep Iyer" role="Field Sales Rep" zone="Karnataka" mfa={false} sess={51} last="13:42"/>
                  <UserRow name="Priya Sharma" role="Back-Office Admin" zone="All India · Master Data" mfa sess={44} last="14:30"/>
                  <UserRow name="Rajeev Menon" role="IT Admin" zone="Platform" mfa sess={12} last="11:14"/>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QualKpi({ label, val, sub, warn, neg }) {
  const color = neg ? 'var(--neg)' : warn ? 'var(--warn)' : 'var(--fg)';
  return (
    <div className="panel">
      <div className="panel-b" style={{ padding: 12 }}>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
        <div className="num" style={{ fontSize: 22, marginTop: 4, color }}>{val}</div>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{sub}</div>
      </div>
    </div>
  );
}

function IssueRow({ type, record, code, issue, when, sev }) {
  const labels = { dup: 'Duplicate', conflict: 'Conflict', incomplete: 'Incomplete' };
  return (
    <tr>
      <td><Tag kind={sev}>{labels[type]}</Tag></td>
      <td><div className="name">{record}</div><div className="sub code">{code}</div></td>
      <td style={{ fontSize: 11 }}>{issue}</td>
      <td className="muted num" style={{ fontSize: 11 }}>{when}</td>
      <td><div style={{ display: 'flex', gap: 4 }}><button className="btn sm">Resolve</button><button className="btn sm ghost">Ignore</button></div></td>
    </tr>
  );
}

function FieldChangeRow({ t, who, what, record }) {
  return (
    <div className="row-data" style={{ padding: '8px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', width: 40 }}>{t}</div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', width: 36, fontWeight: 500 }}>{who}</div>
      <div className="grow" style={{ fontSize: 11 }}>{what} <span style={{ color: 'var(--fg-3)' }}>on</span> <strong style={{ fontWeight: 500 }}>{record}</strong></div>
    </div>
  );
}

function UserRow({ name, role, zone, mfa, sess, last }) {
  return (
    <tr>
      <td><div className="name">{name}</div></td>
      <td style={{ fontSize: 11 }}><Tag>{role}</Tag></td>
      <td className="muted" style={{ fontSize: 11 }}>{zone}</td>
      <td className="center">{mfa ? <Ic.check size={12} style={{ color: 'var(--pos)' }}/> : <span style={{ color: 'var(--warn)', fontSize: 11 }}>—</span>}</td>
      <td className="center num">{sess}</td>
      <td className="center muted num" style={{ fontSize: 11 }}>{last}</td>
      <td><button className="btn sm ghost"><Ic.dots size={12}/></button></td>
    </tr>
  );
}

window.VisitCalendar = VisitCalendar;
window.AdminConsole = AdminConsole;
