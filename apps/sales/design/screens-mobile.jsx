// screens-mobile.jsx — Mobile field rep screens

const { Ic, Tag, Photo } = window;

// Mobile shell — used inside iOS frames
function MobileShell({ children, tabbar = 'today' }) {
  const tabs = [
    { id: 'today', label: 'Today', icon: Ic.cal },
    { id: 'clients', label: 'Clients', icon: Ic.client },
    { id: 'visit', label: 'Visit', icon: Ic.plus, primary: true },
    { id: 'tasks', label: 'Tasks', icon: Ic.check },
    { id: 'me', label: 'Me', icon: Ic.user },
  ];
  return (
    <div className="ris-root ph-screen">
      <div className="ph-body">{children}</div>
      <nav className="ph-tabbar">
        {tabs.map(t => (
          <div key={t.id} className={`tab ${t.id === tabbar ? 'is-active' : ''}`}>
            {t.primary ? (
              <div style={{ width: 44, height: 44, background: 'var(--accent)', color: '#fff', borderRadius: 22, display: 'grid', placeItems: 'center', marginTop: -10, boxShadow: '0 4px 12px rgba(201, 124, 78, 0.4)' }}>
                <t.icon size={20}/>
              </div>
            ) : (
              <>
                <t.icon size={20}/>
                <span>{t.label}</span>
              </>
            )}
          </div>
        ))}
      </nav>
    </div>
  );
}
window.MobileShell = MobileShell;

// ─── Status bar overlay ───
function SyncBar({ state = 'online' }) {
  const states = {
    online: { c: 'var(--pos)', t: 'Synced · all up to date', i: Ic.wifi },
    offline: { c: 'var(--warn)', t: 'Offline · 3 reports queued', i: Ic.wifiOff },
    syncing: { c: 'var(--info)', t: 'Syncing 3 of 5…', i: Ic.sync },
  };
  const s = states[state];
  return (
    <div style={{ padding: '8px 16px', background: 'var(--bg-paper)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: s.c }}>
      <s.i size={13}/>
      <span style={{ fontFamily: 'var(--font-mono)' }}>{s.t}</span>
    </div>
  );
}
window.SyncBar = SyncBar;

// ─────────────────────────────────────────────────────────────
// 1. Day Planner (Today)
// ─────────────────────────────────────────────────────────────
function MobileDay() {
  return (
    <MobileShell tabbar="today">
      <SyncBar state="online"/>
      {/* Header */}
      <div style={{ padding: '18px 18px 14px', background: 'var(--bg-paper)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>Friday · 16 May 2026</div>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 2 }}>Good morning, Akshay</div>
        <div style={{ display: 'flex', gap: 14, marginTop: 14 }}>
          <DayStat label="Today" v="4" sub="visits"/>
          <DayStat label="Compliance" v="84%" sub="this week" col="var(--pos)"/>
          <DayStat label="Quota" v="56%" sub="₹3.5 / 6.2 Cr"/>
        </div>
      </div>

      {/* Today's plan */}
      <div style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-3)' }}>Today's plan</span>
        <Tag>4 visits · 198 km</Tag>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-3)' }}><Ic.map size={11}/> Route</div>
      </div>

      <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {RIS.todayPlan.map((v, i) => (
          <VisitCard key={v.id} v={v} first={i === 0}/>
        ))}
      </div>

      {/* Tasks */}
      <div style={{ padding: '0 16px 16px' }}>
        <div className="h-rule"><span className="t">Open follow-ups · 3</span><div className="line"/></div>
        <div className="ph-card" style={{ padding: 0 }}>
          <TaskRow due="Today" text="Send PCP MX-80 datasheet to Dalmia procurement" client="KOLH02A004"/>
          <TaskRow due="Mon" text="Confirm spare list with Mr Joshi · 8 line items" client="KOLH02A004"/>
          <TaskRow due="Wed" text="Walk through new ETP at Sahyadri" client="SATA01A012"/>
        </div>
      </div>
    </MobileShell>
  );
}

function DayStat({ label, v, sub, col }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div className="num" style={{ fontSize: 20, marginTop: 2, color: col || 'inherit' }}>{v}</div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)' }}>{sub}</div>
    </div>
  );
}

function VisitCard({ v, first }) {
  return (
    <div className="ph-card" style={{ padding: 0, overflow: 'hidden', borderColor: first ? 'var(--accent-line)' : 'var(--line)', borderWidth: first ? 1 : 1 }}>
      {first && <div style={{ background: 'var(--accent)', color: '#fff', padding: '4px 14px', fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em' }}>UP NEXT · 25 min away</div>}
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <span className="num" style={{ fontSize: 14, fontWeight: 500 }}>{v.time}</span>
          <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{v.km} km</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{v.clientName}</div>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>{v.industry} · {v.city}</div>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>{v.purpose}</div>
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: v.overdue ? 'var(--neg)' : 'var(--fg-3)' }}>{v.lastVisit}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn sm ghost"><Ic.pin size={11}/> Navigate</button>
            {first && <button className="btn sm accent" style={{ background: 'var(--accent)', color: '#fff', border: 0 }}>Check in →</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskRow({ due, text, client }) {
  return (
    <div className="row-data">
      <div style={{ width: 16, height: 16, border: '1.5px solid var(--line-strong)', borderRadius: 4, flexShrink: 0 }}/>
      <div className="grow">
        <div style={{ fontSize: 12 }}>{text}</div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{client} · Due {due}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 2. GPS Check-In
// ─────────────────────────────────────────────────────────────
function MobileCheckin() {
  return (
    <div className="ris-root ph-screen">
      <div className="ph-head">
        <div className="back"><Ic.chevLeft/></div>
        <div>
          <h1>Check in</h1>
          <div className="sub">Dalmia Kolhapur · KOLH02A004</div>
        </div>
      </div>
      {/* Map preview */}
      <div className="map-grid" style={{ height: 220, position: 'relative' }}>
        <svg width="100%" height="220" viewBox="0 0 360 220" style={{ position: 'absolute', inset: 0 }}>
          <path d="M0 130 Q60 100 120 110 Q180 120 260 90 Q320 75 360 80" stroke="rgba(28,26,23,0.2)" fill="none" strokeWidth="2"/>
          <path d="M20 160 L100 150 L180 170 L260 140 L340 130" stroke="rgba(28,26,23,0.12)" fill="none" strokeWidth="1" strokeDasharray="3 2"/>
          {/* registered point */}
          <g transform="translate(190, 110)">
            <circle r="60" fill="var(--accent)" opacity="0.10"/>
            <circle r="36" fill="var(--accent)" opacity="0.15"/>
            <circle r="6" fill="var(--accent)"/>
          </g>
          {/* user location */}
          <g transform="translate(176, 122)">
            <circle r="14" fill="var(--info)" opacity="0.3"/>
            <circle r="7" fill="var(--info)" stroke="#fff" strokeWidth="2"/>
          </g>
        </svg>
        <div style={{ position: 'absolute', top: 14, left: 14, right: 14, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', padding: 10, borderRadius: 8, fontSize: 11, color: 'var(--fg-2)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)' }}>
          <span><Ic.pin size={11}/> 16.6925° N, 74.2433° E</span>
          <span style={{ color: 'var(--pos)', fontWeight: 500 }}>● within 18m</span>
        </div>
      </div>

      <div className="ph-body" style={{ padding: 16 }}>
        {/* Confirmation card */}
        <div className="ph-card" style={{ marginBottom: 14, borderColor: 'var(--pos)', background: 'var(--pos-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--pos)', color: '#fff', display: 'grid', placeItems: 'center' }}>
              <Ic.check size={16} sw={2.4}/>
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'oklch(0.35 0.11 155)' }}>Location verified</div>
              <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 2 }}>18m from registered plant point · within 500m radius</div>
            </div>
          </div>
        </div>

        {/* Visit summary */}
        <div style={{ marginBottom: 6, fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>Visit context</div>
        <div className="ph-card" style={{ padding: 0 }}>
          <div className="row-data">
            <div className="grow">
              <div className="t">Quote Follow-up</div>
              <div className="s">3 × PCP MX-80 · Q-2024-018 · ₹36.8 Cr</div>
            </div>
            <Tag kind="accent">Planned</Tag>
          </div>
          <div className="row-data">
            <div className="grow">
              <div className="t">Last visit · 91 days ago</div>
              <div className="s">Equipment assessment by you on 14 Feb · 8 items logged</div>
            </div>
            <Tag kind="warn">Overdue</Tag>
          </div>
          <div className="row-data">
            <div className="grow">
              <div className="t">Primary contact</div>
              <div className="s">Mr Sanjay Joshi · GM Engineering</div>
            </div>
            <button className="btn sm ghost" style={{ padding: 5 }}><Ic.phone size={13}/></button>
          </div>
        </div>

        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--fg-3)' }}>
          Tap below to record check-in. Visit clock starts; report can be completed during or after meeting.
        </div>

        <button className="btn accent" style={{ width: '100%', justifyContent: 'center', padding: '14px', marginTop: 14, background: 'var(--accent)', color: '#fff', border: 0, fontSize: 14, fontWeight: 500 }}>
          <Ic.pin size={14}/> Check in to Dalmia Kolhapur
        </button>
        <button className="btn ghost" style={{ width: '100%', justifyContent: 'center', padding: 10, marginTop: 8, color: 'var(--fg-3)', fontSize: 12 }}>
          Not the right plant? Manual check-in →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 3. Visit Report Form
// ─────────────────────────────────────────────────────────────
function MobileVisitReport() {
  return (
    <div className="ris-root ph-screen">
      <div className="ph-head">
        <div className="back"><Ic.chevLeft/></div>
        <div>
          <h1>Visit Report</h1>
          <div className="sub">Dalmia Kolhapur · checked in 09:31</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>Auto-saved</div>
      </div>

      {/* Progress */}
      <div style={{ padding: '8px 16px', background: 'var(--bg-paper)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-3)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
          <span>Step 2 of 3 · Visit report</span>
          <span>67%</span>
        </div>
        <div className="bar"><div className="fill" style={{ width: '67%' }}/></div>
      </div>

      <div className="ph-body" style={{ padding: 16 }}>
        <div className="field">
          <label>Contacts met <span className="req">·</span></label>
          <div className="chip-row">
            <span className="chip is-on accent">Mr S. Joshi · GM Eng</span>
            <span className="chip is-on accent">Mr R. Patil · CE</span>
            <span className="chip">Mrs G. Kulkarni · PO</span>
            <span className="chip">+ Add new</span>
          </div>
        </div>

        <div className="field">
          <label>Visit purpose <span className="req">·</span></label>
          <div className="chip-row">
            <span className="chip">Routine</span>
            <span className="chip is-on">Quote Follow-up</span>
            <span className="chip">Complaint</span>
            <span className="chip">New Opportunity</span>
            <span className="chip">Equipment Assessment</span>
            <span className="chip">Mgmt Relationship</span>
          </div>
        </div>

        <div className="field">
          <label>Meeting outcome <span className="req">·</span></label>
          <div style={{ display: 'flex', gap: 6 }}>
            <OutcomeChip v="++" l="Very Positive" on/>
            <OutcomeChip v="+" l="Positive"/>
            <OutcomeChip v="◐" l="Neutral"/>
            <OutcomeChip v="!" l="Attention"/>
            <OutcomeChip v="!!" l="Escalate"/>
          </div>
        </div>

        <div className="field">
          <label>Discussion summary</label>
          <textarea defaultValue="Mr Joshi confirmed quote acceptance subject to revised payment terms (60-day). MD Mr Deshmukh joined for 20 min; discussed FY27 capacity expansion (2× distillery line). Asked for proposal on full distillery package by 30 May. Mr Patil walked us through the new ETP — 2 Netzsch PCP units at end of life, requested displacement quote."/>
          <div className="hint" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>372 / 1000 chars</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)' }}><Ic.mic size={11}/> Dictating · 02:14</span>
          </div>
        </div>

        <div className="field">
          <label>Competitor activity observed?</label>
          <div className="chip-row">
            <span className="chip is-on">Yes — Netzsch quote referenced</span>
            <span className="chip">No</span>
          </div>
        </div>

        <div className="field">
          <label>Photos · 3 attached</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
            <Photo label="ETP-Netzsch" h={64}/>
            <Photo label="ETP nameplate" h={64}/>
            <Photo label="distillery line" h={64}/>
            <div style={{ height: 64, border: '1px dashed var(--line-2)', borderRadius: 4, display: 'grid', placeItems: 'center', color: 'var(--fg-3)' }}><Ic.camera/></div>
          </div>
        </div>

        <div className="field">
          <label>Follow-up action</label>
          <div className="ph-card" style={{ padding: 12, background: 'var(--bg-paper)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Ic.check size={14}/>
              <span style={{ fontSize: 12, fontWeight: 500 }}>Send full distillery package proposal</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 6, marginLeft: 22 }}>Due 30 May 2026 · Assigned to me</div>
          </div>
        </div>

        <div className="field">
          <label>Next visit recommendation</label>
          <input defaultValue="13 Jun 2026" type="text"/>
        </div>
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--line)', background: 'var(--bg-paper)', display: 'flex', gap: 8 }}>
        <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }}>Save draft</button>
        <button className="btn primary" style={{ flex: 2, justifyContent: 'center' }}>Continue to Equipment →</button>
      </div>
    </div>
  );
}

function OutcomeChip({ v, l, on }) {
  return (
    <div style={{ flex: 1, padding: 8, border: `1px solid ${on ? 'var(--accent)' : 'var(--line-2)'}`, borderRadius: 6, background: on ? 'var(--accent-soft)' : 'var(--bg-elev)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <span className="num" style={{ fontSize: 18, color: on ? 'var(--accent)' : 'var(--fg-3)' }}>{v}</span>
      <span style={{ fontSize: 9, color: on ? 'var(--accent)' : 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1.1 }}>{l}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 4. Equipment Assessment
// ─────────────────────────────────────────────────────────────
function MobileEquipment() {
  return (
    <div className="ris-root ph-screen">
      <div className="ph-head">
        <div className="back"><Ic.chevLeft/></div>
        <div>
          <h1>Equipment Assessment</h1>
          <div className="sub">Dalmia Kolhapur · 7 logged, 1 in progress</div>
        </div>
      </div>

      <div className="ph-body" style={{ padding: 16 }}>
        {/* Logged so far */}
        <div className="h-rule"><span className="t">Logged this visit</span><div className="line"/><Tag kind="accent">2 displacement opps</Tag></div>
        <div className="ph-card" style={{ padding: 0 }}>
          {RIS.equipmentDalmia.slice(0, 4).map(e => (
            <div key={e.id} className="row-data">
              <div className="grow">
                <div style={{ fontSize: 12, fontWeight: 500 }}>{e.station}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  <span style={{ color: e.supplier === 'RIL' ? 'var(--accent)' : 'inherit', fontWeight: 500 }}>{e.supplier}</span> {e.model} · {e.type} × {e.qty}
                </div>
              </div>
              <Tag kind={e.condition === 'Good' ? 'pos' : e.condition === 'Requires Maintenance' ? 'warn' : 'neg'} dot>{e.condition}</Tag>
            </div>
          ))}
        </div>

        {/* In progress form */}
        <div className="h-rule"><span className="t">Add entry #8</span><div className="line"/></div>
        <div className="ph-card">
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Station / location <span className="req">·</span></label>
            <input defaultValue="Molasses Transfer"/>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Pump type <span className="req">·</span></label>
            <div className="chip-row">
              <span className="chip is-on">PCP</span>
              <span className="chip">MMP</span>
              <span className="chip">Other</span>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Supplier <span className="req">·</span></label>
            <div className="chip-row">
              <span className="chip">RIL</span>
              <span className="chip is-on">Rotomac</span>
              <span className="chip">Roto</span>
              <span className="chip">Netzsch</span>
              <span className="chip">Gita</span>
              <span className="chip">+ More</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Quantity</label>
              <input defaultValue="2" type="number"/>
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Model</label>
              <input defaultValue="RM-50"/>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Condition <span className="req">·</span></label>
            <div className="chip-row">
              <span className="chip">Good</span>
              <span className="chip is-on" style={{ background: 'var(--warn-soft)', color: 'oklch(0.45 0.14 80)', borderColor: 'var(--warn)' }}>Requires Maint.</span>
              <span className="chip">End of Life</span>
              <span className="chip">Unknown</span>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Nameplate photo</label>
            <div style={{ height: 100, border: '1px dashed var(--line-2)', borderRadius: 6, display: 'grid', placeItems: 'center', background: 'var(--bg-paper)' }}>
              <div style={{ textAlign: 'center', color: 'var(--fg-3)' }}>
                <Ic.camera size={20}/>
                <div style={{ fontSize: 11, marginTop: 4 }}>Tap to photograph nameplate</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--accent-soft)', borderRadius: 8, border: '1px solid var(--accent-line)', display: 'flex', gap: 10 }}>
          <Ic.target style={{ color: 'var(--accent)', flexShrink: 0 }}/>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'oklch(0.45 0.14 50)' }}>Live: 2 displacement opportunities flagged</div>
            <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 3 }}>2× Netzsch (Spent Wash) + 3× Gita (ETP) marked End of Life. Est. replacement value ~₹8.4 Cr will appear on Anjali's dashboard the moment you submit.</div>
          </div>
        </div>
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--line)', background: 'var(--bg-paper)', display: 'flex', gap: 8 }}>
        <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }}>Save entry</button>
        <button className="btn primary" style={{ flex: 2, justifyContent: 'center' }}><Ic.plus size={12}/> Save & add another</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 5. Offline Sync state
// ─────────────────────────────────────────────────────────────
function MobileOffline() {
  return (
    <MobileShell tabbar="today">
      <div style={{ padding: '10px 16px', background: 'oklch(0.94 0.06 85)', borderBottom: '1px solid var(--warn)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Ic.wifiOff size={14} style={{ color: 'oklch(0.45 0.14 80)' }}/>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'oklch(0.35 0.14 80)' }}>Working offline · 3 items queued</div>
          <div style={{ fontSize: 10, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' }}>Last sync 11:42 · queue secured locally</div>
        </div>
      </div>

      <div style={{ padding: 18 }}>
        <div className="h-rule"><span className="t">Queued for sync</span><div className="line"/><Tag kind="warn">3</Tag></div>
        <div className="ph-card" style={{ padding: 0 }}>
          <QueueRow icon={Ic.list} title="Visit report · Dalmia Kolhapur" sub="12 fields · 3 photos · 1.4 MB" t="completed 12:14" status="pending"/>
          <QueueRow icon={Ic.tower} title="Equipment assessment · 8 entries" sub="2 displacement opps flagged" t="completed 12:46" status="pending"/>
          <QueueRow icon={Ic.user} title="New contact · Mr P. Kale" sub="Asst. Engineer · Dalmia Kolhapur" t="added 12:48" status="pending"/>
        </div>

        <div className="h-rule"><span className="t">Synced earlier today</span><div className="line"/></div>
        <div className="ph-card" style={{ padding: 0 }}>
          <QueueRow icon={Ic.list} title="Visit report · Sahyadri Karad" sub="Equipment census started" t="synced 11:42" status="done"/>
          <QueueRow icon={Ic.pin} title="Check-in · Sahyadri Karad" sub="±32m · GPS verified" t="synced 11:38" status="done"/>
          <QueueRow icon={Ic.check} title="Task completed · 2 items" sub="ETP report sent · spares list reviewed" t="synced 10:14" status="done"/>
        </div>

        <div className="h-rule"><span className="t">Available offline</span><div className="line"/></div>
        <div className="ph-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500 }}>Today's 4 clients</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>Full profiles · revenue · contacts · last 8 visits</div>
            </div>
            <Tag kind="pos" dot>Ready</Tag>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500 }}>Equipment library</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>14 suppliers · 240 models</div>
            </div>
            <Tag kind="pos" dot>Ready</Tag>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500 }}>Pricing reference</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>Updated 09:14 this morning</div>
            </div>
            <Tag kind="pos" dot>Ready</Tag>
          </div>
        </div>
      </div>
    </MobileShell>
  );
}

function QueueRow({ icon: I, title, sub, t, status }) {
  return (
    <div className="row-data">
      <div style={{ width: 32, height: 32, background: 'var(--bg-sunk)', borderRadius: 6, display: 'grid', placeItems: 'center', color: status === 'done' ? 'var(--pos)' : 'var(--warn)', flexShrink: 0 }}>
        <I size={14}/>
      </div>
      <div className="grow">
        <div style={{ fontSize: 12, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)' }}>{sub}</div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{t}</div>
      </div>
      {status === 'pending' ? <Tag kind="warn" dot>queued</Tag> : <Tag kind="pos" dot>synced</Tag>}
    </div>
  );
}

window.MobileDay = MobileDay;
window.MobileCheckin = MobileCheckin;
window.MobileVisitReport = MobileVisitReport;
window.MobileEquipment = MobileEquipment;
window.MobileOffline = MobileOffline;
