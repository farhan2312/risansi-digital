// screens-mobile-sugar2.jsx — Competitor pumps capture (Sugar)

function MobileCompetitorPumps() {
  return (
    <div className="ris-root ph-screen">
      <div className="ph-head">
        <div className="back"><Ic.chevLeft/></div>
        <div>
          <h1>Competitor Pumps</h1>
          <div className="sub">Step 4 of 5 · Walk plant with Mr Patil</div>
        </div>
      </div>

      <div style={{ padding: '8px 16px', background: 'var(--bg-paper)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-3)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
          <span>14 competitor units catalogued · 2 EOL</span>
          <span>80%</span>
        </div>
        <div className="bar"><div className="fill" style={{ width: '80%' }}/></div>
      </div>

      <div className="ph-body" style={{ padding: 16 }}>
        {/* Type tabs */}
        <div className="chip-row" style={{ marginBottom: 14 }}>
          <span className="chip is-on">Screw Pumps · 9</span>
          <span className="chip">Rota Pumps · 5</span>
        </div>

        {/* Existing entries */}
        <div className="h-rule"><span className="t">Logged competitor screw pumps</span><div className="line"/></div>
        <div className="ph-card" style={{ padding: 0, marginBottom: 14 }}>
          <CompPumpRow make="Netzsch" model="NE-200" app="Spent Wash" qty={2} reason="Tech · viscosity rating" cond="EOL"/>
          <CompPumpRow make="Roto" model="R-150" app="Molasses" qty={3} reason="Commercial · L2 supplier" cond="Good"/>
          <CompPumpRow make="Gita" model="G-90" app="ETP" qty={3} reason="Commercial · OEM tied" cond="EOL"/>
          <CompPumpRow make="Rotomac" model="RM-50" app="Magma" qty={2} reason="Tech · footprint" cond="Maint"/>
        </div>

        {/* In-progress entry — captures Make / Qty / App / MOC / Drive / Reason */}
        <div className="h-rule"><span className="t">Add entry · screw pump</span><div className="line"/></div>
        <div className="ph-card">
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Pump make</label>
              <select defaultValue="Tushaco">
                <option>Tushaco</option><option>Netzsch</option><option>Roto</option><option>Rotomac</option>
                <option>Gita</option><option>Sintech</option><option>PSP</option><option>Mahalaxmi</option>
                <option>Other…</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Quantity</label>
              <input defaultValue="2" type="number"/>
            </div>
          </div>

          <div className="field" style={{ marginTop: 12, marginBottom: 12 }}>
            <label>Application / media</label>
            <div className="chip-row">
              <span className="chip is-on">Boiler Feed</span>
              <span className="chip">Molasses</span>
              <span className="chip">Massecuite</span>
              <span className="chip">Syrup</span>
              <span className="chip">Spent Wash</span>
              <span className="chip">ETP</span>
              <span className="chip">+ Other</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            <CompactField label="Capacity" v="42 m³/h"/>
            <CompactField label="Head" v="60 m"/>
            <CompactField label="KW" v="22"/>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <CompactField label="MOC" v="SS 316"/>
            <CompactField label="Drive" v="VFD"/>
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>Reason client uses competitor</label>
            <div className="chip-row">
              <span className="chip">Technical</span>
              <span className="chip is-on">Commercial</span>
              <span className="chip">Inherited</span>
              <span className="chip">OEM tied</span>
              <span className="chip">+ Other</span>
            </div>
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>Current condition</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <CondChip l="Good"/>
              <CondChip l="Maint" on/>
              <CondChip l="EOL"/>
              <CondChip l="Unknown"/>
            </div>
          </div>

          <div style={{ padding: 10, background: 'var(--accent-soft)', borderRadius: 6, fontSize: 11, color: 'var(--fg-2)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <Ic.camera size={14} style={{ color: 'var(--accent)' }}/>
            <span>Photo nameplate · adds capacity, head, KW automatically</span>
          </div>
        </div>

        {/* Pricing intel toggle */}
        <div className="h-rule"><span className="t">Pricing & visual intel</span><div className="line"/></div>
        <div className="ph-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500 }}>Competitor prices & pictures captured?</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>Stored to client intel folder, restricted to managers</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <span className="chip is-on">Yes · 3</span>
              <span className="chip">No</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
            <Photo label="Tushaco TS-300" h={60}/>
            <Photo label="Netzsch quote" h={60}/>
            <Photo label="Gita G-90" h={60}/>
            <div style={{ height: 60, border: '1px dashed var(--line-2)', borderRadius: 4, display: 'grid', placeItems: 'center', color: 'var(--fg-3)' }}><Ic.plus/></div>
          </div>
        </div>
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--line)', background: 'var(--bg-paper)', display: 'flex', gap: 8 }}>
        <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }}>← Back</button>
        <button className="btn primary" style={{ flex: 2, justifyContent: 'center' }}>Save entry & continue →</button>
      </div>
    </div>
  );
}

function CompPumpRow({ make, model, app, qty, reason, cond }) {
  const cMap = { Good: 'pos', Maint: 'warn', EOL: 'neg' };
  return (
    <div className="row-data">
      <div className="grow">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 12 }}>{make}</span>
          <span className="code" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{model}</span>
          <span className="num" style={{ fontSize: 11 }}>× {qty}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>{app} · {reason}</div>
      </div>
      <Tag kind={cMap[cond]} dot>{cond}</Tag>
    </div>
  );
}

function CompactField({ label, v }) {
  return (
    <div style={{ padding: 8, border: '1px solid var(--line-2)', borderRadius: 5, background: 'var(--bg-elev)' }}>
      <div style={{ fontSize: 9, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{label}</div>
      <div className="num" style={{ fontSize: 13, marginTop: 2 }}>{v}</div>
    </div>
  );
}
function CondChip({ l, on }) {
  const map = { Good: 'pos', Maint: 'warn', EOL: 'neg', Unknown: null };
  return (
    <div style={{ flex: 1, padding: '8px', borderRadius: 5, border: `1px solid ${on ? 'var(--accent)' : 'var(--line-2)'}`, background: on ? 'var(--accent-soft)' : 'var(--bg-elev)', textAlign: 'center', fontSize: 11, fontWeight: 500, color: on ? 'var(--accent)' : 'var(--fg-2)' }}>{l}</div>
  );
}

window.MobileCompetitorPumps = MobileCompetitorPumps;
