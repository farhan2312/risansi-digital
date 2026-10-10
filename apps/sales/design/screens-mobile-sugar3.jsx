// screens-mobile-sugar3.jsx — Commercial discussion checklist + Non-Sugar variant

// ─────────────────────────────────────────────────────────────
// COMMERCIAL DISCUSSION — the Yes/No matrix from sugar visit format
// ─────────────────────────────────────────────────────────────
function MobileCommercialQs() {
  return (
    <div className="ris-root ph-screen">
      <div className="ph-head">
        <div className="back"><Ic.chevLeft/></div>
        <div>
          <h1>Commercial Discussion</h1>
          <div className="sub">Step 5 of 5 · Final</div>
        </div>
      </div>

      <div style={{ padding: '8px 16px', background: 'var(--bg-paper)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-3)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
          <span>5 of 8 questions complete</span>
          <span>62%</span>
        </div>
        <div className="bar"><div className="fill" style={{ width: '62%' }}/></div>
      </div>

      <div className="ph-body" style={{ padding: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 14, lineHeight: 1.5 }}>
          Tap Yes to capture detail. All answers auto-route — Yes on <em>Plans for expansion</em> creates a pipeline opportunity; Yes on <em>Running complaints</em> creates a task.
        </div>

        <QYesNo
          q="Client purchasing route"
          options={['Direct', 'Through OEM', 'Trader / Distributor']}
          ans="Direct"
          detail="Direct purchase via Mumbai purchase office. PO routes through Mr Kale (Asst. Purchase)."
        />

        <QYesNo
          q="Plans for expansion or new projects?"
          ans="Yes"
          detail="FY27 distillery line 2 (Phase 2) — adds 220 KLPD. Capex sign-off expected Q3 FY26. Pump scope: 6× spent wash PCP, 2× molasses MMP."
          autoCreated="opportunity P-2641 created · ₹84 Cr"
        />

        <QYesNo
          q="Pending offers under discussion?"
          ans="Yes"
          detail="Q-2024-018 · 3× PCP MX-80 · ₹36.8 Cr · Mr Joshi committed PO by 30 May."
          link="P-2635"
        />

        <QYesNo
          q="Running complaints?"
          ans="No"
        />

        <QYesNo
          q="Returnable material in client custody?"
          ans="Yes"
          detail="2× stator castings sent for warranty replacement on 12 Mar. Return tracking #RM-4012."
          link="task"
        />

        <QYesNo
          q="Outstanding payment / commercial issues?"
          ans="No"
        />

        <QYesNo
          q="Performance certificate required?"
          ans="Yes"
          detail="Mr Joshi requested PC for last 2 supplies (ROT-100 × 2 at distillery) before FY26 audit close."
        />

        <QYesNo
          q="Last orders captured for traceability?"
          ans={null}
        >
          <div style={{ padding: 12, background: 'var(--bg-paper)', borderRadius: 6, marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: 'var(--fg-3)' }}>Last Pump order</span>
              <span className="num">PO-2025-0892 · ₹2.4 Cr · Mar 26</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: 'var(--fg-3)' }}>Last Spares order</span>
              <span className="num">PO-2026-0124 · ₹38.6 L · Apr 26</span>
            </div>
          </div>
        </QYesNo>

        {/* Summary */}
        <div className="h-rule"><span className="t">Visit summary</span><div className="line"/></div>
        <div className="ph-card">
          <textarea defaultValue="Strong meeting. MD confirmed FY27 capacity expansion → significant opportunity. Need to submit full distillery package proposal by 30 May. Two displacement opportunities flagged at Spent Wash (Netzsch) and ETP (Gita) — propose alongside expansion bid for better leverage. Mr Joshi receptive to RIL spares programme; suggest quarterly review meeting.&#10;&#10;Next visit recommended 13 Jun to close Q-2024-018."/>
          <div className="hint" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>402 / 1000 chars</span>
            <span><Ic.mic size={11}/> Voice input ready</span>
          </div>
        </div>

        {/* Checked-by */}
        <div className="h-rule"><span className="t">Checked by</span><div className="line"/></div>
        <div className="ph-card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500 }}>Submit for Manager review</div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>Routes to Mahesh Joshi (West Zone)</div>
          </div>
          <span className="chip is-on accent">Required</span>
        </div>
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--line)', background: 'var(--bg-paper)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }}>← Back</button>
          <button className="btn primary" style={{ flex: 2, justifyContent: 'center', background: 'var(--accent)', borderColor: 'var(--accent)' }}>
            <Ic.check size={13}/> Submit visit report
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', textAlign: 'center', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
          On submit: 1 opportunity · 2 displacement leads · 1 follow-up task created
        </div>
      </div>
    </div>
  );
}

function QYesNo({ q, ans, detail, options, autoCreated, link, children }) {
  const ynOptions = options || ['Yes', 'No'];
  return (
    <div className="ph-card" style={{ marginBottom: 10, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500, flex: 1, lineHeight: 1.4 }}>{q}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {ynOptions.map(o => (
            <span key={o} className={`chip ${ans === o ? 'is-on' : ''}`} style={{ padding: '4px 8px', fontSize: 10 }}>{o}</span>
          ))}
        </div>
      </div>
      {detail && (
        <div style={{ padding: 10, background: 'var(--bg-paper)', borderRadius: 5, borderLeft: '2px solid var(--accent)', fontSize: 11, color: 'var(--fg-2)', lineHeight: 1.5 }}>
          {detail}
        </div>
      )}
      {(autoCreated || link) && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Ic.arrowRight size={10}/> {autoCreated || `linked → ${link}`}
        </div>
      )}
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// NON-SUGAR variant — simpler unified pump table
// ─────────────────────────────────────────────────────────────
function MobileNonSugarVisit() {
  return (
    <div className="ris-root ph-screen">
      <div className="ph-head">
        <div className="back"><Ic.chevLeft/></div>
        <div>
          <h1>Non-Sugar Visit</h1>
          <div className="sub">Sabar Dairy · Dairy · checked in 11:14</div>
        </div>
      </div>

      <div className="ph-body" style={{ padding: 16 }}>
        {/* Industry context */}
        <div className="ph-card" style={{ padding: 12, marginBottom: 14, background: 'var(--bg-paper)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <ContextCell label="Industry" v="Dairy"/>
            <ContextCell label="Company type" v="End User · GCMMF"/>
            <ContextCell label="Deal in" v="PCP + Spares · Direct"/>
            <ContextCell label="Visited by" v="Mahesh Joshi"/>
          </div>
        </div>

        {/* Single unified pumps table */}
        <div className="h-rule"><span className="t">Pumps installed · all suppliers</span><div className="line"/><Tag>12 units logged</Tag></div>
        <div className="ph-card" style={{ padding: 0 }}>
          <NSPumpHead/>
          <NSPumpRow type="PCP" make="RIL" model="PCM-65" app="Milk reception" qty={3} ril/>
          <NSPumpRow type="PCP" make="RIL" model="PCM-25" app="Cream dosing" qty={2} ril/>
          <NSPumpRow type="MMP" make="RIL" model="MMP-50" app="CIP circulation" qty={2} ril/>
          <NSPumpRow type="PCP" make="RIL" model="PCM-40" app="Curd transfer" qty={2} ril/>
          <NSPumpRow type="PCP" make="Sintech" model="ST-60" app="Milk reception" qty={2} cond="EOL" opp/>
          <NSPumpRow type="MMP" make="Tushaco" model="TS-180" app="Boiler feed" qty={1}/>
        </div>

        <button className="btn ghost" style={{ width: '100%', justifyContent: 'space-between', marginTop: 10, padding: '12px 14px', border: '1px solid var(--line-2)' }}>
          <span><Ic.plus size={12}/> Add pump entry · Type · Make · Application · Cap · Pressure · KW · Reason</span>
          <Ic.chevRight size={12}/>
        </button>

        {/* Valves — Non-Sugar specific */}
        <div className="h-rule"><span className="t">Valves observed</span><div className="line"/></div>
        <div className="ph-card" style={{ padding: 0 }}>
          <div className="row-data">
            <div className="grow">
              <div className="t">Butterfly · DN-80</div>
              <div className="s">SS 316 body · pneumatic actuator · 4 units · CIP line</div>
            </div>
            <Tag>Spirax</Tag>
          </div>
          <div className="row-data">
            <div className="grow">
              <div className="t">Diaphragm · DN-50</div>
              <div className="s">PTFE · manual · 6 units · sampling</div>
            </div>
            <Tag>SS</Tag>
          </div>
        </div>

        {/* Summary */}
        <div className="h-rule"><span className="t">Summary</span><div className="line"/></div>
        <div className="ph-card">
          <textarea defaultValue="Sintech PCP at milk reception is EOL — Mr Bhatt confirmed replacement plan for FY27 capex. RIL well-positioned, has shadowed Sintech since 2021. Opportunity sized at ₹14.4 Cr.&#10;&#10;Mr Bhatt asked for spares schedule for installed RIL fleet — will email matrix by 25 May."/>
        </div>
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--line)', background: 'var(--bg-paper)', display: 'flex', gap: 8 }}>
        <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }}>Save draft</button>
        <button className="btn primary" style={{ flex: 2, justifyContent: 'center' }}>Submit report →</button>
      </div>
    </div>
  );
}

function ContextCell({ label, v }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 500, marginTop: 2 }}>{v}</div>
    </div>
  );
}
function NSPumpHead() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '0.7fr 1fr 1.4fr 0.5fr', padding: '8px 12px', background: 'var(--bg-paper)', borderBottom: '1px solid var(--line)', fontSize: 9, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      <span>Type</span><span>Make · Model</span><span>Application</span><span style={{ textAlign: 'right' }}>Qty</span>
    </div>
  );
}
function NSPumpRow({ type, make, model, app, qty, ril, opp, cond }) {
  return (
    <div className="row-data" style={{ display: 'grid', gridTemplateColumns: '0.7fr 1fr 1.4fr 0.5fr', padding: '10px 12px', background: opp ? 'oklch(0.97 0.04 50)' : 'transparent' }}>
      <div><Tag>{type}</Tag></div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: ril ? 'var(--accent)' : 'var(--fg)' }}>{make}</div>
        <div className="code" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{model}</div>
      </div>
      <div style={{ fontSize: 11 }}>
        {app}
        {opp && <div style={{ marginTop: 2 }}><Tag kind="accent">REPLACE</Tag></div>}
      </div>
      <div style={{ textAlign: 'right' }} className="num">{qty}</div>
    </div>
  );
}

window.MobileCommercialQs = MobileCommercialQs;
window.MobileNonSugarVisit = MobileNonSugarVisit;
