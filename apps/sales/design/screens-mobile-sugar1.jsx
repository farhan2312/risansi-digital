// screens-mobile-sugar.jsx — Industry-aware visit report forms
// Mirrors the Sugar/Non-Sugar Excel formats currently used in the field.

// ─────────────────────────────────────────────────────────────
// SUGAR VISIT REPORT — structured commercial discussion
// ─────────────────────────────────────────────────────────────
function MobileSugarVisit() {
  return (
    <div className="ris-root ph-screen">
      <div className="ph-head">
        <div className="back"><Ic.chevLeft/></div>
        <div>
          <h1>Sugar Visit Report</h1>
          <div className="sub">Dalmia Kolhapur · checked in 09:31</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>Auto-saved</div>
      </div>

      {/* Step strip */}
      <div style={{ padding: '8px 16px', background: 'var(--bg-paper)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', gap: 6, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
          <StepDot n="1" label="Identity" done/>
          <StepDot n="2" label="Contacts" done/>
          <StepDot n="3" label="RIL Pumps" active/>
          <StepDot n="4" label="Competitor"/>
          <StepDot n="5" label="Commercial"/>
        </div>
      </div>

      <div className="ph-body" style={{ padding: 16 }}>
        {/* Identity recap */}
        <div className="ph-card" style={{ marginBottom: 14, padding: 12, background: 'var(--bg-paper)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Client</div>
              <div style={{ fontWeight: 500, marginTop: 2 }}>Dalmia Kolhapur · Existing</div>
              <div className="code" style={{ color: 'var(--fg-3)', fontSize: 10 }}>KOLH02A004 · Sugar + Distillery</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Visited by</div>
              <div style={{ fontWeight: 500, marginTop: 2 }}>Akshay Pawar</div>
              <div className="code" style={{ color: 'var(--fg-3)', fontSize: 10 }}>16 May 2026 · 09:31</div>
            </div>
          </div>
        </div>

        {/* RIL Screw Pumps — application matrix */}
        <div className="h-rule">
          <span className="t">RIL Screw Pumps installed · by application</span>
          <div className="line"/>
          <Tag kind="accent">18 units</Tag>
        </div>
        <div className="ph-card" style={{ padding: 0 }}>
          <AppMatrixHead/>
          <AppMatrixRow app="Molasses" qty={4} model="PCM-180"/>
          <AppMatrixRow app="Magma" qty={3} model="PCM-120"/>
          <AppMatrixRow app="Syrup" qty={2} model="PCM-65"/>
          <AppMatrixRow app="Massecuite" qty={5} model="PCM-200"/>
          <AppMatrixRow app="Melt" qty={2} model="PCM-85"/>
          <AppMatrixRow app="Dosing" qty={2} model="PCM-25"/>
          <AppMatrixRow app="Other" qty={0} muted/>
        </div>

        {/* Quick action to drill into model detail */}
        <button className="btn ghost" style={{ width: '100%', justifyContent: 'space-between', marginTop: 10, padding: '12px 14px', border: '1px solid var(--line-2)' }}>
          <span><Ic.list size={12}/> View 18 entries with model · capacity · head · KW · drive</span>
          <Ic.chevRight size={12}/>
        </button>

        {/* RIL Rota Pumps */}
        <div className="h-rule">
          <span className="t">RIL Rota Pumps installed</span>
          <div className="line"/>
          <Tag>4 units</Tag>
        </div>
        <div className="ph-card" style={{ padding: 0 }}>
          <AppMatrixRow app="Massecuite" qty={2} model="ROT-100" feedback="Good"/>
          <AppMatrixRow app="Molasses" qty={2} model="ROT-65" feedback="Good"/>
          <AppMatrixRow app="Magma" qty={0} muted/>
          <AppMatrixRow app="Syrup" qty={0} muted/>
        </div>

        {/* Spares feedback */}
        <div className="h-rule"><span className="t">Performance feedback · RIL spares</span><div className="line"/></div>
        <div className="ph-card">
          <div className="chip-row" style={{ marginBottom: 10 }}>
            <span className="chip">Excellent</span>
            <span className="chip is-on">Good</span>
            <span className="chip">Average</span>
            <span className="chip">Poor</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-2)', lineHeight: 1.5 }}>
            Mr Patil noted shaft seals on PCM-180 outlasting Netzsch equivalent by ~30% in molasses service. Stator wear on PCM-120 acceptable; replacing every 14 months.
          </div>
        </div>
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--line)', background: 'var(--bg-paper)', display: 'flex', gap: 8 }}>
        <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }}>← Back</button>
        <button className="btn primary" style={{ flex: 2, justifyContent: 'center' }}>Next · Competitor pumps →</button>
      </div>
    </div>
  );
}

function StepDot({ n, label, done, active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
      <div style={{
        width: 18, height: 18, borderRadius: '50%',
        background: done ? 'var(--pos)' : active ? 'var(--accent)' : 'var(--bg-sunk)',
        color: done || active ? '#fff' : 'var(--fg-3)',
        display: 'grid', placeItems: 'center',
        fontSize: 10, fontWeight: 600,
      }}>{done ? '✓' : n}</div>
      <span style={{ color: active ? 'var(--accent)' : done ? 'var(--fg-2)' : 'var(--fg-3)', fontWeight: active ? 600 : 400, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
    </div>
  );
}

function AppMatrixHead() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.6fr 1fr 0.8fr', padding: '8px 12px', borderBottom: '1px solid var(--line)', background: 'var(--bg-paper)', fontSize: 9, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
      <span>Application</span>
      <span className="center" style={{ textAlign: 'center' }}>Qty</span>
      <span>Model</span>
      <span className="center" style={{ textAlign: 'right' }}>Status</span>
    </div>
  );
}
function AppMatrixRow({ app, qty, model, feedback, muted }) {
  return (
    <div className="row-data" style={{ padding: '10px 12px', opacity: muted ? 0.5 : 1 }}>
      <div style={{ flex: 1.2, fontSize: 12, fontWeight: 500 }}>{app}</div>
      <div style={{ flex: 0.6, textAlign: 'center' }} className="num">{muted ? '—' : qty}</div>
      <div style={{ flex: 1, fontSize: 11 }} className="code">{model || '—'}</div>
      <div style={{ flex: 0.8, textAlign: 'right' }}>
        {muted ? null : feedback ? <Tag kind="pos" dot>{feedback}</Tag> : <Ic.chevRight size={12} style={{ opacity: 0.4 }}/>}
      </div>
    </div>
  );
}

window.MobileSugarVisit = MobileSugarVisit;
