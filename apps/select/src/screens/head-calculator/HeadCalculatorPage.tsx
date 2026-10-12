"use client";

import { useMemo, useState, type ReactNode } from "react";

import PageHeader from "../../components/ui/PageHeader";
import {
  BEND_ANGLES,
  calculateHead,
  DEFAULT_HEAD_CALC_INPUT,
  LINE_SIZES,
  type HeadCalcInput,
} from "../../lib/head-calculator";
import {
  calculateDischarge,
  DEFAULT_DISCHARGE_INPUT,
  DISCHARGE_BEND_ANGLES,
  DISCHARGE_LINE_SIZES,
  type DischargeCalcInput,
} from "../../lib/discharge-calculator";

const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");

const inputCls =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-fg outline-none transition placeholder:text-fg-4 focus:border-accent focus:ring-2 focus:ring-accent-soft [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

const STATUS_STYLE = {
  ok: { pill: "bg-[var(--pos-soft)] text-pos", bar: "linear-gradient(90deg, var(--brand-cyan), #5ce0f5)", ring: "var(--pos)" },
  caution: { pill: "bg-[var(--warn-soft)] text-warn", bar: "linear-gradient(90deg, #e8a22a, #ffc862)", ring: "var(--warn)" },
  bad: { pill: "bg-[var(--neg-soft)] text-neg", bar: "linear-gradient(90deg, #e0524a, #ff9b95)", ring: "var(--neg)" },
} as const;

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-paper">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-accent [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
        <h2 className="text-[13.5px] font-semibold text-fg">{title}</h2>
      </header>
      <div className="grid grid-cols-1 gap-3.5 p-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  unit,
  span,
  children,
}: {
  label: string;
  unit?: string;
  span?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${span ? "sm:col-span-2" : ""}`}>
      <span className="flex items-center justify-between gap-2 text-[12px] font-medium text-fg-2">
        {label}
        {unit && <span className="rounded bg-elev px-1.5 py-px font-mono text-[10.5px] text-fg-3">{unit}</span>}
      </span>
      {children}
    </label>
  );
}

const Note = ({ children }: { children: ReactNode }) => (
  <p className="rounded-lg bg-elev px-3 py-2 text-[11.5px] leading-relaxed text-fg-3 sm:col-span-2">{children}</p>
);

/**
 * Head Calculator, two modes:
 *  - Suction: NPSH and suction-line losses (lib/head-calculator.ts, ported
 *    from calculator/App.jsx).
 *  - Discharge: head the pump must develop on the discharge line
 *    (lib/discharge-calculator.ts, from the discharge-line workbook).
 * Everything recalculates as you type.
 */
export type CalcMode = "suction" | "discharge";

const HeadCalculatorPage = () => {
  const [mode, setMode] = useState<CalcMode>("suction");
  const [discharge, setDischarge] = useState<DischargeCalcInput>(DEFAULT_DISCHARGE_INPUT);
  const [form, setForm] = useState<HeadCalcInput>(DEFAULT_HEAD_CALC_INPUT);

  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-5 pb-10 sm:px-6">
      <PageHeader
        icon={<CalcGlyph />}
        title="Head Calculator"
        subtitle={
          mode === "suction"
            ? "NPSH and suction line calculator · process engineering, pump suction sizing"
            : "Discharge line calculator · head the pump must develop on the discharge side"
        }
        actions={
          <>
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--pos-soft)] px-3 py-1.5 text-[12px] font-semibold text-pos">
              <span className="h-2 w-2 animate-pulse rounded-full bg-pos" />
              Live calculation
            </span>
            <button
              type="button"
              onClick={() => (mode === "suction" ? setForm(DEFAULT_HEAD_CALC_INPUT) : setDischarge(DEFAULT_DISCHARGE_INPUT))}
              className="rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 transition hover:border-accent hover:text-accent"
            >
              Reset
            </button>
          </>
        }
      />

      <HeadCalculatorView
        mode={mode}
        setMode={setMode}
        suction={form}
        setSuction={setForm}
        discharge={discharge}
        setDischarge={setDischarge}
      />
    </div>
  );
};

/** The two calculators with their Suction / Discharge switch — the Head
 *  Calculator page, and the pop-up on the General Information step. */
export function HeadCalculatorView({
  mode,
  setMode,
  suction,
  setSuction,
  discharge,
  setDischarge,
}: {
  mode: CalcMode;
  setMode: (m: CalcMode) => void;
  suction: HeadCalcInput;
  setSuction: React.Dispatch<React.SetStateAction<HeadCalcInput>>;
  discharge: DischargeCalcInput;
  setDischarge: React.Dispatch<React.SetStateAction<DischargeCalcInput>>;
}) {
  return (
    <>
      {/* Suction / Discharge */}
      <div className="mt-4 inline-flex rounded-xl border border-line bg-paper p-1" role="tablist" aria-label="Calculator">
        {(
          [
            ["suction", "Suction (NPSH)"],
            ["discharge", "Discharge"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-colors ${
              mode === key ? "bg-accent text-white shadow-[0_1px_2px_rgba(10,61,143,0.2)]" : "text-fg-3 hover:bg-elev hover:text-fg"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "discharge" ? (
        <DischargePanel form={discharge} setForm={setDischarge} />
      ) : (
        <SuctionPanel form={suction} setForm={setSuction} />
      )}
    </>
  );
}

/** Suction (NPSH) calculator: inputs on the left, the margin and its make-up on the right. */
function SuctionPanel({
  form,
  setForm,
}: {
  form: HeadCalcInput;
  setForm: React.Dispatch<React.SetStateAction<HeadCalcInput>>;
}) {
  const result = useMemo(() => calculateHead(form), [form]);
  const style = STATUS_STYLE[result.status];

  const set =
    (key: keyof HeadCalcInput) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const numberInput = (key: keyof HeadCalcInput, step: string, min = "0") => (
    <input type="number" inputMode="decimal" className={inputCls} value={form[key]} onChange={set(key)} step={step} min={min} />
  );

  const breakdown = [
    { label: "Static height × SG", value: result.pressureFromHeight, hint: `${form.verticalHeight || 0} m × ${form.specificGravity || 0}` },
    {
      label: "Line friction",
      value: result.frictionLossLine,
      hint: `${form.lineSize}" line · ${fmt(result.capacityTph)} TPH · ${form.viscosity || 0} cP · ${fmt(result.totalDistance)} m`,
    },
    { label: "Bends", value: result.frictionLossBends, hint: `${form.noBends || 0} × ${result.bendLossPerBend} (${form.bendAngle}°)` },
    { label: "Suction valves", value: result.frictionLossValves, hint: `${form.valves || 0} × 1.00` },
    { label: "NRVs", value: result.frictionLossNRV, hint: `${form.nrv || 0} × 1.00` },
  ];
  const maxLoss = Math.max(0.0001, ...breakdown.map((b) => b.value));


  return (
      <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* Inputs */}
        <div className="space-y-4">
          <Section icon={<DropGlyph />} title="Fluid & Duty">
            <Field label="Application">
              <input type="text" className={inputCls} value={form.application} onChange={set("application")} />
            </Field>
            <Field label="Specific Gravity" unit="–">
              {numberInput("specificGravity", "0.01", "0.01")}
            </Field>
            <Field label="Capacity">
              <div className="flex min-w-0 gap-2">
                <div className="min-w-0 flex-1">{numberInput("capacity", "0.1")}</div>
                <select className={`${inputCls.replace("w-full ", "")} w-[96px] shrink-0`} value={form.capacityUnit} onChange={set("capacityUnit")}>
                  <option value="TPH">TPH</option>
                  <option value="M3">m³/hr</option>
                </select>
              </div>
            </Field>
            <Field label="Viscosity" unit="cP">
              {numberInput("viscosity", "100")}
            </Field>
            {form.capacityUnit === "M3" && (
              <Note>
                1 TPH = 1 m³/hr × Specific Gravity. The m³/hr entered is converted automatically (
                <b className="font-mono text-fg-2">{fmt(result.capacityTph)} TPH</b>).
              </Note>
            )}
          </Section>

          <Section icon={<PipeGlyph />} title="Suction Line and Fittings">
            <Field label="Suction Line Size" unit="in" span>
              <select className={inputCls} value={form.lineSize} onChange={set("lineSize")}>
                {LINE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}&quot;
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vertical Height" unit="m">
              {numberInput("verticalHeight", "0.1")}
            </Field>
            <Field label="Horizontal Distance" unit="m">
              {numberInput("horizontalDistance", "0.1")}
            </Field>
            <Field label="Angle of Bends" unit="°">
              <select className={inputCls} value={form.bendAngle} onChange={set("bendAngle")}>
                {BEND_ANGLES.map((a) => (
                  <option key={a} value={a}>
                    {a}°
                  </option>
                ))}
              </select>
            </Field>
            <Field label="No. of Bends" unit="–">
              {numberInput("noBends", "1")}
            </Field>
            <Field label="Suction Valves" unit="count">
              {numberInput("valves", "1")}
            </Field>
            <Field label="NRVs" unit="count">
              {numberInput("nrv", "1")}
            </Field>
          </Section>

          <Section icon={<GaugeGlyph />} title="Suction Conditions">
            <Field label="Atmospheric / Source Head" unit="MWC">
              {numberInput("atmPressure", "0.1")}
            </Field>
            <Field label="NPSH Required (NPSHR)" unit="MWC">
              {numberInput("npshr", "0.1")}
            </Field>
            <Note>
              Atmospheric / source head is the available head at the suction vessel. NPSHR is read from the pump
              manufacturer&apos;s curve at the duty flow.
            </Note>
          </Section>
        </div>

        {/* Results */}
        <div className="space-y-4 xl:sticky xl:top-4">
          <section className="relative overflow-hidden rounded-2xl border border-line bg-[linear-gradient(160deg,#0a1628_0%,#132a4d_60%,#0f3a5c_100%)] p-5 text-white shadow-[0_12px_32px_rgba(10,22,40,0.25)]">
            <div
              className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-40 blur-3xl"
              style={{ background: style.ring }}
            />
            <div className="relative">
              <h2 className="text-[16px] font-semibold">NPSH Margin</h2>
              <p className="text-[12px] text-white/60">Available suction head vs. pump requirement{form.application ? ` · ${form.application}` : ""}</p>

              <div className="mt-5 space-y-4">
                {[
                  { k: "NPSHA", sub: "Available", pct: result.npshaPct, v: result.npsha, bg: style.bar },
                  { k: "NPSHR", sub: "Required", pct: result.npshrPct, v: result.npshr, bg: "linear-gradient(90deg, #8aa0bd, #c3d0e0)" },
                ].map((g) => (
                  <div key={g.k} className="grid grid-cols-[72px_minmax(0,1fr)_64px] items-center gap-3">
                    <div>
                      <div className="text-[13px] font-bold">{g.k}</div>
                      <div className="text-[10.5px] text-white/55">{g.sub}</div>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${g.pct}%`, background: g.bg }} />
                    </div>
                    <div className="text-right font-mono text-[15px] font-bold tabular-nums">{fmt(g.v)}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap items-end justify-between gap-3 rounded-xl bg-white/[0.06] px-4 py-3.5 ring-1 ring-white/10">
                <div>
                  <div className="text-[10.5px] font-semibold tracking-[0.1em] text-white/55 uppercase">Margin (NPSHA − NPSHR)</div>
                  <div className="mt-1 font-mono text-[34px] leading-none font-bold tabular-nums">
                    {fmt(result.margin)}
                    <span className="ml-1.5 font-sans text-[13px] font-medium text-white/60">MWC</span>
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${style.pill}`}>{result.statusText}</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { label: "Total Head Loss", v: result.totalLoss },
                  { label: "NPSH Available", v: result.npsha },
                ].map((t) => (
                  <div key={t.label} className="rounded-xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10">
                    <div className="text-[10.5px] font-semibold tracking-[0.08em] text-white/55 uppercase">{t.label}</div>
                    <div className="mt-1 font-mono text-[20px] font-bold tabular-nums">
                      {fmt(t.v)}
                      <span className="ml-1 font-sans text-[11px] font-medium text-white/60">MWC</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-line bg-paper">
            <header className="border-b border-line px-4 py-3">
              <h2 className="text-[13.5px] font-semibold text-fg">Head loss breakdown</h2>
              <p className="text-[11.5px] text-fg-3">How the total suction loss is made up (MWC)</p>
            </header>
            <ul className="space-y-3 p-4">
              {breakdown.map((b) => (
                <li key={b.label}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="text-fg-2">{b.label}</span>
                    <span className="font-mono font-semibold text-fg tabular-nums">{fmt(b.value)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--brand-blue)] to-[var(--brand-cyan)] transition-[width] duration-500"
                      style={{ width: `${Math.max(0, (b.value / maxLoss) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-0.5 text-[11px] text-fg-3">{b.hint}</div>
                </li>
              ))}
              <li className="flex items-baseline justify-between border-t border-line pt-3 text-[13px] font-semibold">
                <span className="text-fg">Total head loss</span>
                <span className="font-mono text-title tabular-nums">{fmt(result.totalLoss)}</span>
              </li>
              <li className="flex items-baseline justify-between text-[12.5px]">
                <span className="text-fg-2">NPSHA = source head − total loss</span>
                <span className="font-mono text-fg tabular-nums">
                  {fmt(parseFloat(form.atmPressure) || 0)} − {fmt(result.totalLoss)} = {fmt(result.npsha)}
                </span>
              </li>
            </ul>
          </section>
        </div>
      </div>
  );
}

/** Discharge-line calculator: inputs on the left, the head and its make-up on the right. */
function DischargePanel({
  form,
  setForm,
}: {
  form: DischargeCalcInput;
  setForm: React.Dispatch<React.SetStateAction<DischargeCalcInput>>;
}) {
  const result = useMemo(() => calculateDischarge(form), [form]);
  const set =
    (key: keyof DischargeCalcInput) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  const numberInput = (key: keyof DischargeCalcInput, step: string, min = "0") => (
    <input type="number" inputMode="decimal" className={inputCls} value={form[key]} onChange={set(key)} step={step} min={min} />
  );

  const breakdown = [
    { label: "Static height × SG", value: result.pressureFromHeight, hint: `${form.verticalHeight || 0} m × ${form.specificGravity || 0}` },
    {
      label: "Line friction",
      value: result.frictionLossLine,
      hint: `${form.lineSize}" line (${Number(result.lineLossBase.toFixed(4))} MWC base) · ${fmt(result.capacityTph)} TPH · ${form.viscosity || 0} cP · ${fmt(result.totalDistance)} m`,
    },
    { label: "Bends", value: result.frictionLossBends, hint: `${form.noBends || 0} × ${result.bendLossPerBend} (${form.bendAngle}°)` },
    { label: "Discharge valves", value: result.frictionLossValves, hint: `${form.valves || 0} × 1.00` },
    { label: "NRVs", value: result.frictionLossNRV, hint: `${form.nrv || 0} × 1.00` },
  ];
  const maxLoss = Math.max(0.0001, ...breakdown.map((b) => b.value));
  const friction = result.frictionLossLine + result.frictionLossBends + result.frictionLossValves + result.frictionLossNRV;

  return (
    <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Section icon={<DropGlyph />} title="Fluid & Duty">
          <Field label="Application">
            <input type="text" className={inputCls} value={form.application} onChange={set("application")} />
          </Field>
          <Field label="Specific Gravity" unit="–">
            {numberInput("specificGravity", "0.01", "0.01")}
          </Field>
          <Field label="Capacity">
            <div className="flex min-w-0 gap-2">
              <div className="min-w-0 flex-1">{numberInput("capacity", "0.1")}</div>
              <select className={`${inputCls.replace("w-full ", "")} w-[96px] shrink-0`} value={form.capacityUnit} onChange={set("capacityUnit")}>
                <option value="TPH">TPH</option>
                <option value="M3">m³/hr</option>
              </select>
            </div>
          </Field>
          <Field label="Viscosity" unit="cP">
            {numberInput("viscosity", "100")}
          </Field>
          {form.capacityUnit === "M3" && (
            <Note>
              1 TPH = 1 m³/hr × Specific Gravity. The m³/hr entered is converted automatically (
              <b className="font-mono text-fg-2">{fmt(result.capacityTph)} TPH</b>).
            </Note>
          )}
        </Section>

        <Section icon={<PipeGlyph />} title="Discharge Line and Fittings">
          <Field label="Discharge Line Size" unit="in" span>
            <select className={inputCls} value={form.lineSize} onChange={set("lineSize")}>
              {DISCHARGE_LINE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}&quot;
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vertical Height" unit="m">
            {numberInput("verticalHeight", "0.1")}
          </Field>
          <Field label="Horizontal Distance" unit="m">
            {numberInput("horizontalDistance", "0.1")}
          </Field>
          <Field label="Angle of Bends" unit="°">
            <select className={inputCls} value={form.bendAngle} onChange={set("bendAngle")}>
              {DISCHARGE_BEND_ANGLES.map((a) => (
                <option key={a} value={a}>
                  {a}°
                </option>
              ))}
            </select>
          </Field>
          <Field label="No. of Bends" unit="–">
            {numberInput("noBends", "1")}
          </Field>
          <Field label="Discharge Valves" unit="count">
            {numberInput("valves", "1")}
          </Field>
          <Field label="NRVs" unit="count">
            {numberInput("nrv", "1")}
          </Field>
          <Note>
            Vertical height is how far the liquid is lifted from the pump to the discharge point; total pipe length =
            vertical + horizontal ({fmt(result.totalDistance)} m).
          </Note>
        </Section>
      </div>

      <div className="space-y-4 xl:sticky xl:top-4">
        <section className="relative overflow-hidden rounded-2xl border border-line bg-[linear-gradient(160deg,#0a1628_0%,#132a4d_60%,#0f3a5c_100%)] p-5 text-white shadow-[0_12px_32px_rgba(10,22,40,0.25)]">
          <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[var(--brand-cyan)] opacity-30 blur-3xl" />
          <div className="relative">
            <h2 className="text-[16px] font-semibold">Discharge Head</h2>
            <p className="text-[12px] text-white/60">
              Head the pump must develop on the discharge line{form.application ? ` · ${form.application}` : ""}
            </p>

            <div className="mt-5 rounded-xl bg-white/[0.06] px-4 py-3.5 ring-1 ring-white/10">
              <div className="text-[10.5px] font-semibold tracking-[0.1em] text-white/55 uppercase">Total discharge head</div>
              <div className="mt-1 font-mono text-[34px] leading-none font-bold tabular-nums">
                {fmt(result.totalHead)}
                <span className="ml-1.5 font-sans text-[13px] font-medium text-white/60">MWC</span>
              </div>
              <div className="mt-2 text-[12px] text-white/60">
                ≈ <b className="font-mono text-white/85">{fmt(result.totalKgCm2)}</b> kg/cm² ·{" "}
                <b className="font-mono text-white/85">{fmt(result.totalBar)}</b> bar
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                { label: "Static head", v: result.pressureFromHeight },
                { label: "Friction losses", v: friction },
              ].map((t) => (
                <div key={t.label} className="rounded-xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10">
                  <div className="text-[10.5px] font-semibold tracking-[0.08em] text-white/55 uppercase">{t.label}</div>
                  <div className="mt-1 font-mono text-[20px] font-bold tabular-nums">
                    {fmt(t.v)}
                    <span className="ml-1 font-sans text-[11px] font-medium text-white/60">MWC</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-paper">
          <header className="border-b border-line px-4 py-3">
            <h2 className="text-[13.5px] font-semibold text-fg">Head breakdown</h2>
            <p className="text-[11.5px] text-fg-3">How the total discharge head is made up (MWC)</p>
          </header>
          <ul className="space-y-3 p-4">
            {breakdown.map((b) => (
              <li key={b.label}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="text-fg-2">{b.label}</span>
                  <span className="font-mono font-semibold text-fg tabular-nums">{fmt(b.value)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--brand-blue)] to-[var(--brand-cyan)] transition-[width] duration-500"
                    style={{ width: `${Math.max(0, (b.value / maxLoss) * 100)}%` }}
                  />
                </div>
                <div className="mt-0.5 text-[11px] text-fg-3">{b.hint}</div>
              </li>
            ))}
            <li className="flex items-baseline justify-between border-t border-line pt-3 text-[13px] font-semibold">
              <span className="text-fg">Total discharge head</span>
              <span className="font-mono text-title tabular-nums">{fmt(result.totalHead)}</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const CalcGlyph = () => (
  <svg {...svgProps}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01M16 18h.01" />
  </svg>
);
const DropGlyph = () => (
  <svg {...svgProps}>
    <path d="M12 2.5C12 2.5 5.5 11 5.5 15.5a6.5 6.5 0 0013 0C18.5 11 12 2.5 12 2.5z" />
  </svg>
);
const PipeGlyph = () => (
  <svg {...svgProps}>
    <path d="M4 4v8a4 4 0 0 0 4 4h12" />
    <circle cx="4" cy="4" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="20" cy="16" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);
const GaugeGlyph = () => (
  <svg {...svgProps}>
    <path d="M4 15a8 8 0 1 1 16 0" />
    <path d="M12 15l4.2-4.2" />
    <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

export default HeadCalculatorPage;
