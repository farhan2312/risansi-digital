import { useMemo, useState } from 'react'

// ---------------------------------------------------------------
// Reference tables & calculation logic
// (mirrors "Reference & Calculations" tab of the source workbook)
// ---------------------------------------------------------------

// Table 2 — Frictional Loss (Bends), MWC per bend
const BEND_LOSS_TABLE = { 90: 1.5, 60: 1, 45: 0.75, 30: 0.5 }

// Table 3 — Fixed losses per fitting, MWC
const VALVE_LOSS = 1
const NRV_LOSS = 1

// Table 1 — Frictional Loss (Line Size), MWC
// base value @ 1 TPH, 10,000 cP, 100 m, as a function of nominal bore (inches)
function lineSizeFrictionLoss(diaInches) {
  return (
    ((0.0273 * (10000 * 1 * 0.2728)) / Math.pow(diaInches, 4)) *
    ((10.5 / 14.7) * 100) / 3.28
  ) / 1.4
}

const num = (value) => {
  const v = parseFloat(value)
  return isNaN(v) ? 0 : v
}

const fmt = (value) => value.toFixed(2)

const LINE_SIZES = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16]

export default function App() {
  const [form, setForm] = useState({
    application: 'Molasses',
    specificGravity: '1.4',
    capacity: '5',
    capacityUnit: 'TPH',
    viscosity: '15000',
    lineSize: '4',
    verticalHeight: '3',
    horizontalDistance: '0',
    bendAngle: '45',
    noBends: '1',
    valves: '0',
    nrv: '0',
    atmPressure: '10.5',
    npshr: '3.5',
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const result = useMemo(() => {
    const sg = num(form.specificGravity)

    // Capacity, converted to TPH-equivalent if entered as m3/hr
    let capacity = num(form.capacity)
    if (form.capacityUnit === 'M3') {
      capacity = capacity * sg
    }

    const lineSize = parseFloat(form.lineSize)
    const verticalHeight = num(form.verticalHeight)
    const horizontalDistance = num(form.horizontalDistance)
    const totalDistance = verticalHeight + horizontalDistance

    const bendAngle = parseFloat(form.bendAngle)
    const noBends = num(form.noBends)
    const valves = num(form.valves)
    const nrv = num(form.nrv)
    const viscosity = num(form.viscosity)
    const atmPressure = num(form.atmPressure)
    const npshr = num(form.npshr)

    // Lookups
    const lineLoss = lineSizeFrictionLoss(lineSize)
    const bendLossPerBend = BEND_LOSS_TABLE[bendAngle] || 0

    // Step-by-step losses
    const pressureFromHeight = verticalHeight * sg // 1
    const frictionLossLine =
      lineLoss * (capacity / 1) * (viscosity / 10000) * (totalDistance / 100) // 2
    const frictionLossBends = bendLossPerBend * noBends // 3
    const frictionLossValves = valves * VALVE_LOSS // 4
    const frictionLossNRV = nrv * NRV_LOSS // 5

    const totalLoss =
      pressureFromHeight +
      frictionLossLine +
      frictionLossBends +
      frictionLossValves +
      frictionLossNRV
    const npsha = atmPressure - totalLoss
    const margin = npsha - npshr

    let statusText, statusClass
    if (margin >= 1) {
      statusText = 'OK — adequate margin'
      statusClass = 'ok'
    } else if (margin >= 0.5) {
      statusText = 'CAUTION — marginal'
      statusClass = 'caution'
    } else {
      statusText = 'INSUFFICIENT — review suction system'
      statusClass = 'bad'
    }

    // Gauge scale
    const scaleMax = Math.max(atmPressure, npshr, npsha, 1) * 1.15
    const npshaPct = Math.max(0, Math.min(100, (npsha / scaleMax) * 100))
    const npshrPct = Math.max(0, Math.min(100, (npshr / scaleMax) * 100))

    return {
      totalLoss,
      npsha,
      npshr,
      margin,
      statusText,
      statusClass,
      npshaPct,
      npshrPct,
    }
  }, [form])

  const npshaFill =
    result.statusClass === 'ok'
      ? 'linear-gradient(90deg,var(--cyan),#5CE0F5)'
      : result.statusClass === 'caution'
        ? 'linear-gradient(90deg,#E8A22A,#FFC862)'
        : 'linear-gradient(90deg,#E0524A,#FF9B95)'

  const year = new Date().getFullYear()

  return (
    <div className="app-shell">
      {/* ---------- HEADER ---------- */}
      <header className="topbar">
        <div className="brand">
          <img src="/logo.png" alt="Risansi Industries Ltd" />
          <div className="brand-divider"></div>
          <div className="title-block">
            <h1>NPSH and Suction Line Calculator</h1>
            <p>Process Engineering · Pump Suction Sizing</p>
          </div>
        </div>
        <div className="topbar-tag">Live calculation</div>
      </header>

      <main className="layout">
        {/* ============ INPUTS ============ */}
        <section className="inputs-col">
          <div className="card">
            <h2>
              <span className="icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2.5C12 2.5 5.5 11 5.5 15.5a6.5 6.5 0 0013 0C18.5 11 12 2.5 12 2.5z" />
                </svg>
              </span>
              Fluid &amp; Duty
            </h2>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="application">Application</label>
                <input type="text" id="application" value={form.application} onChange={set('application')} />
              </div>
              <div className="field">
                <label htmlFor="specificGravity">Specific Gravity <span className="unit-tag">–</span></label>
                <input type="number" id="specificGravity" value={form.specificGravity} onChange={set('specificGravity')} step="0.01" min="0.01" />
              </div>
              <div className="field">
                <label htmlFor="capacity">Capacity</label>
                <div className="combo">
                  <input type="number" id="capacity" value={form.capacity} onChange={set('capacity')} step="0.1" min="0" />
                  <select id="capacityUnit" value={form.capacityUnit} onChange={set('capacityUnit')}>
                    <option value="TPH">TPH</option>
                    <option value="M3">m³/hr</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="viscosity">Viscosity <span className="unit-tag">cP</span></label>
                <input type="number" id="viscosity" value={form.viscosity} onChange={set('viscosity')} step="100" min="0" />
              </div>
              <div
                className="field span-2 field-note"
                style={{ display: form.capacityUnit === 'M3' ? 'block' : 'none' }}
              >
                1 TPH = 1 m³/hr × Specific Gravity. Select m³/hr to enter a volumetric flow — it will be converted automatically.
              </div>
            </div>
          </div>

          <div className="card">
            <h2>
              <span className="icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4v8a4 4 0 0 0 4 4h12" />
                  <circle cx="4" cy="4" r="1.6" fill="currentColor" stroke="none" />
                  <circle cx="20" cy="16" r="1.6" fill="currentColor" stroke="none" />
                </svg>
              </span>
              Suction Line and Fittings
            </h2>
            <div className="field-grid">
              <div className="field span-2">
                <label htmlFor="lineSize">Suction Line Size <span className="unit-tag">in</span></label>
                <select id="lineSize" value={form.lineSize} onChange={set('lineSize')}>
                  {LINE_SIZES.map((s) => (
                    <option key={s} value={s}>{s}"</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="verticalHeight">Vertical Height <span className="unit-tag">m</span></label>
                <input type="number" id="verticalHeight" value={form.verticalHeight} onChange={set('verticalHeight')} step="0.1" min="0" />
              </div>
              <div className="field">
                <label htmlFor="horizontalDistance">Horizontal Distance <span className="unit-tag">m</span></label>
                <input type="number" id="horizontalDistance" value={form.horizontalDistance} onChange={set('horizontalDistance')} step="0.1" min="0" />
              </div>
              <div className="field">
                <label htmlFor="bendAngle">Angle of Bends <span className="unit-tag">°</span></label>
                <select id="bendAngle" value={form.bendAngle} onChange={set('bendAngle')}>
                  <option value="90">90°</option>
                  <option value="60">60°</option>
                  <option value="45">45°</option>
                  <option value="30">30°</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="noBends">No. of Bends <span className="unit-tag">–</span></label>
                <input type="number" id="noBends" value={form.noBends} onChange={set('noBends')} step="1" min="0" />
              </div>
              <div className="field">
                <label htmlFor="valves">Suction Valves <span className="unit-tag">count</span></label>
                <input type="number" id="valves" value={form.valves} onChange={set('valves')} step="1" min="0" />
              </div>
              <div className="field">
                <label htmlFor="nrv">NRVs <span className="unit-tag">count</span></label>
                <input type="number" id="nrv" value={form.nrv} onChange={set('nrv')} step="1" min="0" />
              </div>
            </div>
          </div>

          <div className="card">
            <h2>
              <span className="icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15a8 8 0 1 1 16 0" />
                  <path d="M12 15l4.2-4.2" />
                  <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
                </svg>
              </span>
              Suction Conditions
            </h2>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="atmPressure">Atmospheric / Source Head <span className="unit-tag">MWC</span></label>
                <input type="number" id="atmPressure" value={form.atmPressure} onChange={set('atmPressure')} step="0.1" min="0" />
              </div>
              <div className="field">
                <label htmlFor="npshr">NPSH Required (NPSHR) <span className="unit-tag">MWC</span></label>
                <input type="number" id="npshr" value={form.npshr} onChange={set('npshr')} step="0.1" min="0" />
              </div>
              <div className="field span-2 field-note">
                Atmospheric / source head is the available head at the suction vessel. NPSHR is read from the pump manufacturer's curve at the duty flow.
              </div>
            </div>
          </div>
        </section>

        {/* ============ RESULTS ============ */}
        <section className="results-col">
          <div className="panel-dark">
            <h2>NPSH Margin</h2>
            <p className="panel-sub">Available suction head vs. pump requirement</p>

            <div className="gauge">
              <div className="gauge-row">
                <div className="g-label">NPSHA<small>Available</small></div>
                <div className="gauge-track">
                  <div className="gauge-fill npsha" style={{ width: result.npshaPct + '%', background: npshaFill }}></div>
                </div>
                <div className="g-value">{fmt(result.npsha)}</div>
              </div>
              <div className="gauge-row">
                <div className="g-label">NPSHR<small>Required</small></div>
                <div className="gauge-track">
                  <div className="gauge-fill npshr" style={{ width: result.npshrPct + '%' }}></div>
                </div>
                <div className="g-value">{fmt(result.npshr)}</div>
              </div>
            </div>

            <div className="margin-readout">
              <div>
                <div className="m-label">Margin (NPSHA − NPSHR)</div>
                <div className="m-value">{fmt(result.margin)}<span>MWC</span></div>
              </div>
              <div className={'status-pill ' + result.statusClass}>{result.statusText}</div>
            </div>

            <div className="tiles">
              <div className="tile">
                <div className="t-label">Total Head Loss</div>
                <div className="t-value">{fmt(result.totalLoss)}<span>MWC</span></div>
              </div>
              <div className="tile">
                <div className="t-label">NPSH Available</div>
                <div className="t-value">{fmt(result.npsha)}<span>MWC</span></div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        © {year} <strong>Risansi Industries Ltd</strong>
      </footer>
    </div>
  )
}
