"use client";

import type { PumpTestReportPoint } from "@/types/testing";

/**
 * The three performance curves, drawn from a report's own test points -- the
 * digital equivalent of the hand-plotted Risansi curve sheets:
 *
 *   1. Capacity & Absorbed Power vs Head
 *   2. Capacity & Absorbed Power vs Speed
 *   3. Torque vs Speed        (torque = kW x 973 / RPM, per the works formula)
 *
 * A caveat on the speed-based pair: testing steps the head up while holding
 * speed roughly constant, so RPM only droops across a run (e.g. 316 -> 295 as
 * load climbs) rather than being swept 0-400 the way the catalogue sheets do.
 * The relationship is real -- capacity falls and torque rises as the pump
 * bogs down -- but the axis spans only the band actually tested, so these
 * read as a narrow slice rather than a full design curve.
 *
 * Drawn as inline SVG rather than with a chart library: reports are exported
 * via window.print(), and canvas-based charts commonly print blank or
 * rasterised, whereas SVG prints crisply. It also keeps the zero-dependency
 * status quo and picks up the theme's CSS variables for free.
 */

// Real graph paper has square boxes, not whatever rectangle happens to fit a
// fixed canvas -- so the plot area's pixel size is DERIVED below from how
// many divisions each axis needs times this one constant, rather than a
// fixed width/height that x and y divisions would otherwise have to stretch
// unevenly to fill.
const CELL_SIZE = 32;
const PAD = { top: 22, right: 68, bottom: 46, left: 62 };

/** kW -> kgf·m at a given speed, the constant the works curve sheets use. */
const TORQUE_CONSTANT = 973;

interface Series {
  key: string;
  label: string;
  /** "capacity" | "power" | "torque" -- drives the stroke colour. */
  tone: string;
  axis: "left" | "right";
  values: (number | null)[];
}

/**
 * Works-sheet style grid: every chart gets EXACTLY the same number of boxes
 * on each axis (X_DIVISIONS x Y_DIVISIONS, always), so all three curves
 * share one identical layout/size no matter what the underlying report's
 * readings are -- only the printed tick numbers (the mapping) change per
 * chart, picked from a "nice" step (1/2/5 x a power of ten) escalated until
 * exactly that many boxes comfortably spans this chart's own min/max.
 *
 * Whole-number steps are preferred (and are what any normal-range report
 * gets), but a report with a genuinely narrow range -- e.g. a small pump
 * whose Head only spans 0-2 -- would otherwise need step 1 to cover barely
 * 2 of the 10 boxes, leaving most of the chart blank. So the step is allowed
 * to drop below 1 (0.5, 0.2, ...) rather than force that empty look; the
 * fixed box count matters more than every label being an integer.
 *
 * X and Y use different division counts on purpose -- landscape works
 * sheets get their shape because the person drawing them picks a coarser Y
 * scale than X scale (fewer boxes tall than wide), not because the data
 * happens to need fewer.
 */
const X_DIVISIONS = 10;
const Y_DIVISIONS = 6;
const NICE_MULTIPLIERS = [1, 2, 5];

const axisTicks = (min: number, max: number, divisions: number): { lo: number; hi: number; ticks: number[] } => {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) && max > safeMin ? max : safeMin + 1;
  const range = safeMax - safeMin;

  let magnitudeExp = Math.floor(Math.log10(range / divisions || 1));
  for (let attempt = 0; attempt < 30; attempt++) {
    const magnitude = 10 ** magnitudeExp;
    for (const m of NICE_MULTIPLIERS) {
      const step = m * magnitude;
      const lo = Math.floor(safeMin / step) * step;
      const hi = lo + divisions * step;
      if (hi >= safeMax - 1e-9) {
        const ticks = Array.from({ length: divisions + 1 }, (_, i) => Number((lo + i * step).toFixed(6)));
        return { lo, hi, ticks };
      }
    }
    magnitudeExp += 1;
  }
  // Unreachable in practice -- NICE_MULTIPLIERS escalating through decades
  // always catches up to any finite range within a few iterations.
  const step = Math.max(1, Math.ceil(range / divisions));
  const lo = Math.floor(safeMin / step) * step;
  const ticks = Array.from({ length: divisions + 1 }, (_, i) => lo + i * step);
  return { lo, hi: lo + divisions * step, ticks };
};

const tickLabel = (v: number): string =>
  Number.isInteger(v) ? String(v) : String(Number(v.toFixed(v < 10 ? 2 : 1)));

interface ChartProps {
  title: string;
  xLabel: string;
  xValues: number[];
  /** Head starts the axis at zero like the works sheets; speed spans only the
   * band tested, since 0-400 would squash a 295-316 run into a single line. */
  xFromZero: boolean;
  series: Series[];
}

const Chart = ({ title, xLabel, xValues, xFromZero, series }: ChartProps) => {
  const live = series.filter((s) => s.values.filter((v) => v !== null).length >= 2);
  if (live.length === 0 || xValues.length < 2) return null;

  const xMin = xFromZero ? 0 : Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const xAxis = axisTicks(xMin, xMax, X_DIVISIONS);

  const leftSeries = live.filter((s) => s.axis === "left");
  const rightSeries = live.filter((s) => s.axis === "right");

  const rangeOf = (list: Series[]) => {
    const vals = list.flatMap((s) => s.values.filter((v): v is number => v !== null));
    return vals.length ? { min: Math.min(0, ...vals), max: Math.max(...vals) } : null;
  };
  const leftRange = rangeOf(leftSeries);
  const rightRange = rangeOf(rightSeries);
  const leftAxis = leftRange ? axisTicks(leftRange.min, leftRange.max, Y_DIVISIONS) : null;
  const rightAxis = rightRange ? axisTicks(rightRange.min, rightRange.max, Y_DIVISIONS) : null;

  // Grid lines are drawn from whichever of left/right has ticks (left wins
  // when both exist), so that same tick count sets the box height -- keeping
  // every box CELL_SIZE square regardless of how many divisions this
  // particular chart's data happens to need on either axis.
  const xDivisions = xAxis.ticks.length - 1;
  const yDivisions = (leftAxis ?? rightAxis)!.ticks.length - 1;
  const plotW = xDivisions * CELL_SIZE;
  const plotH = yDivisions * CELL_SIZE;
  const width = PAD.left + plotW + PAD.right;
  const height = PAD.top + plotH + PAD.bottom;

  const x = (v: number) =>
    PAD.left + ((v - xAxis.lo) / (xAxis.hi - xAxis.lo || 1)) * plotW;
  const scaler = (a: { lo: number; hi: number }) => (v: number) =>
    PAD.top + plotH - ((v - a.lo) / (a.hi - a.lo || 1)) * plotH;
  const yLeft = leftAxis ? scaler(leftAxis) : null;
  const yRight = rightAxis ? scaler(rightAxis) : null;

  const pathFor = (s: Series) => {
    const y = s.axis === "left" ? yLeft : yRight;
    if (!y) return "";
    return s.values
      .map((v, i) => (v === null ? null : `${x(xValues[i])},${y(v)}`))
      .filter(Boolean)
      .join(" ");
  };

  return (
    <div className="performance-curve">
      <h3>{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={title}>
        {(leftAxis ?? rightAxis)!.ticks.map((t, i) => {
          const y = (yLeft ?? yRight)!((leftAxis ?? rightAxis)!.ticks[i]);
          return <line key={`g-${t}`} className="curve-grid" x1={PAD.left} x2={PAD.left + plotW} y1={y} y2={y} />;
        })}
        {xAxis.ticks.map((t) => (
          <line key={`gx-${t}`} className="curve-grid" x1={x(t)} x2={x(t)} y1={PAD.top} y2={PAD.top + plotH} />
        ))}

        <line className="curve-axis" x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + plotH} />
        <line className="curve-axis" x1={PAD.left} x2={PAD.left + plotW} y1={PAD.top + plotH} y2={PAD.top + plotH} />
        {rightAxis && (
          <line className="curve-axis" x1={PAD.left + plotW} x2={PAD.left + plotW} y1={PAD.top} y2={PAD.top + plotH} />
        )}

        {leftAxis &&
          yLeft &&
          leftAxis.ticks.map((t) => (
            <text key={`ly-${t}`} className="curve-tick" x={PAD.left - 8} y={yLeft(t) + 4} textAnchor="end">
              {tickLabel(t)}
            </text>
          ))}
        {rightAxis &&
          yRight &&
          rightAxis.ticks.map((t) => (
            <text key={`ry-${t}`} className="curve-tick" x={PAD.left + plotW + 8} y={yRight(t) + 4} textAnchor="start">
              {tickLabel(t)}
            </text>
          ))}
        {xAxis.ticks.map((t) => (
          <text key={`xt-${t}`} className="curve-tick" x={x(t)} y={PAD.top + plotH + 18} textAnchor="middle">
            {tickLabel(t)}
          </text>
        ))}

        {leftSeries.length > 0 && (
          <text
            className="curve-axis-title"
            transform={`rotate(-90 14 ${PAD.top + plotH / 2})`}
            x={14}
            y={PAD.top + plotH / 2}
            textAnchor="middle"
          >
            {leftSeries.map((s) => s.label).join(" / ")}
          </text>
        )}
        {rightSeries.length > 0 && (
          <text
            className="curve-axis-title"
            transform={`rotate(90 ${width - 12} ${PAD.top + plotH / 2})`}
            x={width - 12}
            y={PAD.top + plotH / 2}
            textAnchor="middle"
          >
            {rightSeries.map((s) => s.label).join(" / ")}
          </text>
        )}
        <text className="curve-axis-title" x={PAD.left + plotW / 2} y={height - 10} textAnchor="middle">
          {xLabel}
        </text>

        {live.map((s) => (
          <polyline key={s.key} className={`curve-line curve-${s.tone}`} points={pathFor(s)} />
        ))}
      </svg>

      <div className="curve-legend">
        {live.map((s) => (
          <span key={s.key}>
            <i className={`curve-swatch curve-${s.tone}`} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
};

const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);

const PerformanceCurve = ({ points }: { points: PumpTestReportPoint[] }) => {
  const rows = points
    .map((p) => {
      const rpm = num(p.rpm);
      const power = num(p.power_calculated_kw);
      return {
        head: num(p.head_kgcm2),
        rpm,
        capacity: num(p.capacity_calculated_m3hr),
        power,
        // Works formula from the curve sheets: kW x 973 / RPM.
        torque: power !== null && rpm !== null && rpm > 0 ? (power * TORQUE_CONSTANT) / rpm : null,
      };
    })
    .filter((r) => r.capacity !== null || r.power !== null);

  const byHead = rows.filter((r) => r.head !== null).sort((a, b) => (a.head as number) - (b.head as number));
  // A stopped pump isn't an operating point. Imported reports carry the odd
  // rpm=0 stub row (no head, no capacity, just a stray power figure), which
  // would otherwise drag the speed axis to zero and flatten the real band.
  const bySpeed = rows
    .filter((r) => r.rpm !== null && (r.rpm as number) > 0)
    .sort((a, b) => (a.rpm as number) - (b.rpm as number));

  const headChart = (
    <Chart
      title="Capacity &amp; Absorbed Power vs Head"
      xLabel="HEAD (Kg/Cm2)"
      xFromZero
      xValues={byHead.map((r) => r.head as number)}
      series={[
        { key: "cap-h", label: "CAPACITY (M3/Hr)", tone: "capacity", axis: "left", values: byHead.map((r) => r.capacity) },
        { key: "pow-h", label: "ABSORBED POWER (KW)", tone: "power", axis: "right", values: byHead.map((r) => r.power) },
      ]}
    />
  );

  const speedChart = (
    <Chart
      title="Capacity &amp; Absorbed Power vs Speed"
      xLabel="SPEED (RPM)"
      xFromZero={false}
      xValues={bySpeed.map((r) => r.rpm as number)}
      series={[
        { key: "cap-s", label: "CAPACITY (M3/Hr)", tone: "capacity", axis: "left", values: bySpeed.map((r) => r.capacity) },
        { key: "pow-s", label: "ABSORBED POWER (KW)", tone: "power", axis: "right", values: bySpeed.map((r) => r.power) },
      ]}
    />
  );

  const torqueChart = (
    <Chart
      title="Torque vs Speed"
      xLabel="SPEED (RPM)"
      xFromZero={false}
      xValues={bySpeed.map((r) => r.rpm as number)}
      series={[
        { key: "trq", label: "TORQUE (KgM)", tone: "torque", axis: "left", values: bySpeed.map((r) => r.torque) },
      ]}
    />
  );

  return (
    <div className="performance-curves">
      {headChart}
      {speedChart}
      {torqueChart}
    </div>
  );
};

export default PerformanceCurve;
