"use client";

import { useMemo, useState, type ReactNode } from "react";

import { Calculator, Droplet, Gauge, RotateCcw, Waypoints } from "lucide-react";

import PageHeader from "../../components/ui/PageHeader";
// shadcn/ui (user, 2026-11-13: the Head Calculator in the new look, branch select-shadcn).
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Card } from "@/components/shadcn/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs";
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
  "h-8 w-full rounded-md border border-input bg-card px-2.5 text-[12.5px] text-foreground shadow-xs outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/** The margin's verdict: badge tone, the NPSHA bar's colour and the result card's top stripe. */
const STATUS_STYLE = {
  ok: { tone: "success", bar: "var(--chart-done)", ring: "var(--chart-done)" },
  caution: { tone: "warning", bar: "var(--chart-pending)", ring: "var(--chart-pending)" },
  bad: { tone: "danger", bar: "var(--chart-regret)", ring: "var(--chart-regret)" },
} as const;

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <header className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-3">
        <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5">{icon}</span>
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      </header>
      <div className="grid grid-cols-1 gap-3.5 p-4 sm:grid-cols-2">{children}</div>
    </Card>
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
      <span className="flex items-center justify-between gap-2 text-[12px] font-medium text-foreground">
        {label}
        {unit && <span className="rounded bg-muted px-1.5 py-px font-mono text-[10.5px] text-muted-foreground">{unit}</span>}
      </span>
      {children}
    </label>
  );
}

const Note = ({ children }: { children: ReactNode }) => (
  <p className="rounded-md bg-muted px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground sm:col-span-2">{children}</p>
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
    <div className="min-h-full bg-background">
    <div className="w-full px-4 pt-4 pb-10 sm:px-6 2xl:px-8">
      <PageHeader
        icon={<Calculator />}
        title="Head Calculator"
        subtitle={
          mode === "suction"
            ? "NPSH and suction line calculator · process engineering, pump suction sizing"
            : "Discharge line calculator · head the pump must develop on the discharge side"
        }
        actions={
          <>
            <Badge tone="success" className="px-2 py-0.5">
              <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
              Live calculation
            </Badge>
            <Button variant="outline" onClick={() => (mode === "suction" ? setForm(DEFAULT_HEAD_CALC_INPUT) : setDischarge(DEFAULT_DISCHARGE_INPUT))}>
              <RotateCcw /> Reset
            </Button>
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
      <Tabs value={mode} onValueChange={(v) => setMode(v === "discharge" ? "discharge" : "suction")} className="mt-4">
        <TabsList aria-label="Calculator">
          {(
            [
              ["suction", "Suction (NPSH)"],
              ["discharge", "Discharge"],
            ] as const
          ).map(([key, label]) => (
            <TabsTrigger key={key} value={key}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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
          <Section icon={<Droplet />} title="Fluid & Duty">
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
                <b className="font-mono text-foreground">{fmt(result.capacityTph)} TPH</b>).
              </Note>
            )}
          </Section>

          <Section icon={<Waypoints />} title="Suction Line and Fittings">
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

          <Section icon={<Gauge />} title="Suction Conditions">
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
          <Card className="relative overflow-hidden p-5">
            {/* The verdict's colour as a stripe along the top. */}
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: style.ring }} aria-hidden="true" />
            <div className="relative">
              <h2 className="text-[15px] font-semibold text-foreground">NPSH Margin</h2>
              <p className="text-[12px] text-muted-foreground">Available suction head vs. pump requirement{form.application ? ` · ${form.application}` : ""}</p>

              <div className="mt-5 space-y-4">
                {[
                  { k: "NPSHA", sub: "Available", pct: result.npshaPct, v: result.npsha, bg: style.bar },
                  { k: "NPSHR", sub: "Required", pct: result.npshrPct, v: result.npshr, bg: "var(--chart-none)" },
                ].map((g) => (
                  <div key={g.k} className="grid grid-cols-[72px_minmax(0,1fr)_64px] items-center gap-3">
                    <div>
                      <div className="text-[13px] font-semibold text-foreground">{g.k}</div>
                      <div className="text-[10.5px] text-muted-foreground">{g.sub}</div>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${g.pct}%`, background: g.bg }} />
                    </div>
                    <div className="text-right font-mono text-[15px] font-semibold text-foreground tabular-nums">{fmt(g.v)}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap items-end justify-between gap-3 rounded-md bg-muted/60 px-4 py-3.5 ring-1 ring-border ring-inset">
                <div>
                  <div className="text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">Margin (NPSHA − NPSHR)</div>
                  <div className="mt-1 font-mono text-[34px] leading-none font-semibold text-foreground tabular-nums">
                    {fmt(result.margin)}
                    <span className="ml-1.5 font-sans text-[13px] font-medium text-muted-foreground">MWC</span>
                  </div>
                </div>
                <Badge tone={style.tone} dot className="px-2.5 py-1 text-[12px]">
                  {result.statusText}
                </Badge>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { label: "Total Head Loss", v: result.totalLoss },
                  { label: "NPSH Available", v: result.npsha },
                ].map((t) => (
                  <div key={t.label} className="rounded-md bg-muted/60 px-4 py-3 ring-1 ring-border ring-inset">
                    <div className="text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">{t.label}</div>
                    <div className="mt-1 font-mono text-[20px] font-semibold text-foreground tabular-nums">
                      {fmt(t.v)}
                      <span className="ml-1 font-sans text-[11px] font-medium text-muted-foreground">MWC</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <header className="border-b border-border bg-muted/40 px-4 py-3">
              <h2 className="text-[13px] font-semibold text-foreground">Head loss breakdown</h2>
              <p className="text-[11.5px] text-muted-foreground">How the total suction loss is made up (MWC)</p>
            </header>
            <ul className="space-y-3 p-4">
              {breakdown.map((b) => (
                <li key={b.label}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="text-foreground">{b.label}</span>
                    <span className="font-mono font-semibold text-foreground tabular-nums">{fmt(b.value)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[var(--chart-1)] transition-[width] duration-500"
                      style={{ width: `${Math.max(0, (b.value / maxLoss) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{b.hint}</div>
                </li>
              ))}
              <li className="flex items-baseline justify-between border-t border-border pt-3 text-[13px] font-semibold">
                <span className="text-foreground">Total head loss</span>
                <span className="font-mono text-primary tabular-nums">{fmt(result.totalLoss)}</span>
              </li>
              <li className="flex items-baseline justify-between text-[12.5px]">
                <span className="text-muted-foreground">NPSHA = source head − total loss</span>
                <span className="font-mono text-foreground tabular-nums">
                  {fmt(parseFloat(form.atmPressure) || 0)} − {fmt(result.totalLoss)} = {fmt(result.npsha)}
                </span>
              </li>
            </ul>
          </Card>
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
        <Section icon={<Droplet />} title="Fluid & Duty">
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
              <b className="font-mono text-foreground">{fmt(result.capacityTph)} TPH</b>).
            </Note>
          )}
        </Section>

        <Section icon={<Waypoints />} title="Discharge Line and Fittings">
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
        <Card className="relative overflow-hidden p-5">
          <div className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden="true" />
          <div className="relative">
            <h2 className="text-[15px] font-semibold text-foreground">Discharge Head</h2>
            <p className="text-[12px] text-muted-foreground">
              Head the pump must develop on the discharge line{form.application ? ` · ${form.application}` : ""}
            </p>

            <div className="mt-5 rounded-md bg-muted/60 px-4 py-3.5 ring-1 ring-border ring-inset">
              <div className="text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">Total discharge head</div>
              <div className="mt-1 font-mono text-[34px] leading-none font-semibold text-foreground tabular-nums">
                {fmt(result.totalHead)}
                <span className="ml-1.5 font-sans text-[13px] font-medium text-muted-foreground">MWC</span>
              </div>
              <div className="mt-2 text-[12px] text-muted-foreground">
                ≈ <b className="font-mono text-foreground">{fmt(result.totalKgCm2)}</b> kg/cm² ·{" "}
                <b className="font-mono text-foreground">{fmt(result.totalBar)}</b> bar
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                { label: "Static head", v: result.pressureFromHeight },
                { label: "Friction losses", v: friction },
              ].map((t) => (
                <div key={t.label} className="rounded-md bg-muted/60 px-4 py-3 ring-1 ring-border ring-inset">
                  <div className="text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">{t.label}</div>
                  <div className="mt-1 font-mono text-[20px] font-semibold text-foreground tabular-nums">
                    {fmt(t.v)}
                    <span className="ml-1 font-sans text-[11px] font-medium text-muted-foreground">MWC</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <header className="border-b border-border bg-muted/40 px-4 py-3">
            <h2 className="text-[13px] font-semibold text-foreground">Head breakdown</h2>
            <p className="text-[11.5px] text-muted-foreground">How the total discharge head is made up (MWC)</p>
          </header>
          <ul className="space-y-3 p-4">
            {breakdown.map((b) => (
              <li key={b.label}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="text-foreground">{b.label}</span>
                  <span className="font-mono font-semibold text-foreground tabular-nums">{fmt(b.value)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-[var(--chart-1)] transition-[width] duration-500"
                    style={{ width: `${Math.max(0, (b.value / maxLoss) * 100)}%` }}
                  />
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{b.hint}</div>
              </li>
            ))}
            <li className="flex items-baseline justify-between border-t border-border pt-3 text-[13px] font-semibold">
              <span className="text-foreground">Total discharge head</span>
              <span className="font-mono text-primary tabular-nums">{fmt(result.totalHead)}</span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

export default HeadCalculatorPage;
