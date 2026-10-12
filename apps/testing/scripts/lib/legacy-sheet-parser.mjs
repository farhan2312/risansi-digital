/**
 * Parser for the "OBSERVATION SHEET" Excel template used by the pump-testing
 * team's old workbooks (one sheet = one test report). Pure: it takes an
 * already-loaded SheetJS worksheet and returns the fields the portal stores
 * (pump_test_reports / pump_test_report_points). It never touches the DB.
 *
 * Three templates share the layout, told apart by the parameter-row labels:
 *   - Flow Meter: "Capacity m3/hr" is measured directly
 *   - Barrel:     "Capacity IN LPH" + "Time taken to filling barrel"
 *   - V-notch:    "Height taken for filling" + "Height over V notch in mm"
 *
 * Derived per-point fields use the SAME formulas as src/lib/testReportCalc.ts
 * (the Excel-ported engine), re-stated here because this is a plain .mjs
 * script and cannot import the TypeScript module.
 *
 * Conventions follow the reports already stored by the earlier bulk import
 * (see the validation notes in scripts/import-legacy-reports.mjs).
 */

const COLS = "BCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const rawText = (ws, addr) => (addr && ws[addr] && ws[addr].v !== undefined ? String(ws[addr].v) : "");
const cellsIn = (ws) => Object.keys(ws).filter((a) => a[0] !== "!");
const splitAddr = (addr) => {
  const m = /^([A-Z]+)(\d+)$/.exec(addr);
  return { col: m[1], row: Number(m[2]) };
};

/** A cell's numeric value: real numbers as-is, numeric text parsed, anything else null. */
export const numberOf = (c) => {
  if (!c || c.v === undefined || c.v === null || c.v === "") return null;
  if (typeof c.v === "number") return Number.isFinite(c.v) ? c.v : null;
  const text = String(c.v).replace(/,/g, "").trim();
  const n = Number(text);
  return text !== "" && Number.isFinite(n) ? n : null;
};

const round = (v, dp) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/** Excel day-fraction (0.5416..) -> "1:00 PM", matching how the earlier import stored pump start/stop times. */
const timeText = (c) => {
  if (!c || c.v === undefined || c.v === "") return null;
  if (typeof c.v === "number") {
    const minutes = Math.round((c.v % 1) * 24 * 60);
    const h24 = Math.floor(minutes / 60) % 24;
    const mm = String(minutes % 60).padStart(2, "0");
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${mm} ${h24 >= 12 ? "PM" : "AM"}`;
  }
  return clean(c.v) || null;
};

/** d-m-y (2- or 4-digit year) -> YYYY-MM-DD, or null if it isn't a real date. */
const isoDate = (d, m, y) => {
  let year = Number(y);
  if (year < 100) year += 2000;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCMonth() === month - 1 ? dt.toISOString().slice(0, 10) : null;
};

const excelSerialToIso = (n) => (n > 20000 && n < 80000 ? new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10) : null);

const HEAD_UNIT_TO_KGCM2 = { BAR: 1.0197162, MWC: 0.1, MLC: 0.1, MTR: 0.1, M: 0.1, KGCM2: 1, KGCM: 1 };

/** Row numbers of the parameter block, keyed by what the label means. */
function parameterRows(ws) {
  const rows = {};
  let started = false;
  for (let r = 1; r <= 30; r++) {
    const label = clean(rawText(ws, "A" + r)).toLowerCase();
    if (/^parameter/.test(label)) {
      started = true;
      continue;
    }
    if (!started || !label) continue;
    if (/^vibration/.test(label)) break;
    if (/^height taken/.test(label)) rows.heightTaken = r;
    else if (/^height over v/.test(label)) rows.heightOver = r;
    else if (/^time taken/.test(label)) rows.timeSec = r;
    else if (/^capacity in lph|^capacity lph/.test(label)) rows.capacityLph = r;
    else if (/^capacity m3/.test(label)) rows.capacity = r;
    else if (/^discharge pressure/.test(label)) rows.head = r;
    else if (/^speed rpm/.test(label)) rows.rpm = r;
    else if (/^volts/.test(label)) rows.volts = r;
    else if (/^current/.test(label)) rows.amps = r;
    else if (/^\(?cos/.test(label)) rows.cos = r;
    else if (/^power/.test(label)) rows.power = r;
    else if (/^ve\b/.test(label)) rows.ve = r;
    else if (/^me\b/.test(label)) rows.me = r;
  }
  return rows;
}

/** First cell (in the top rows) whose text matches the regex; returns its address or null. */
const findLabel = (ws, re, maxRow = 40) => {
  for (const a of cellsIn(ws)) {
    if (splitAddr(a).row > maxRow) continue;
    const t = clean(ws[a].v);
    if (t && re.test(t)) return a;
  }
  return null;
};

/**
 * @param ws     SheetJS worksheet
 * @param opts   { model } -- the pump model (taken from the workbook / folder name, not the sheet)
 * @returns      { report, points, warnings, meta }
 */
export function parseSheet(ws, { model }) {
  const warnings = [];
  const rows = parameterRows(ws);

  // V-notch has the height rows. Only "Time taken to filling barrel" sheets are Barrel; the "Time taken to fill 5 ltr
  // bucket" variant carries its capacity in the "Capacity m3/hr" row and was stored as Flow Meter by the earlier import.
  const timeLabel = rows.timeSec ? clean(rawText(ws, "A" + rows.timeSec)) : "";
  const testType = rows.heightTaken ? "V-notch" : /filling\s*barr/i.test(timeLabel) ? "Barrel" : "Flow Meter";

  // Point columns run from B up to the column before the "Calculation/Remarks" header (7 columns, sometimes 8).
  let lastPointCol = "H";
  for (let r = 1; r <= 30; r++) {
    if (!/^parameter/i.test(clean(rawText(ws, "A" + r)))) continue;
    for (const c of COLS) {
      if (/calculation\s*\/?\s*remarks/i.test(clean(rawText(ws, c + r)))) {
        lastPointCol = COLS[COLS.indexOf(c) - 1];
        break;
      }
    }
    break;
  }
  const pointColumns = COLS.slice(0, COLS.indexOf(lastPointCol) + 1);

  // ---- header text: every string cell in the top rows ----
  const headerTexts = [];
  for (const a of cellsIn(ws)) {
    if (splitAddr(a).row <= 9 && typeof ws[a].v === "string") headerTexts.push({ addr: a, text: clean(ws[a].v) });
  }
  const headerBlob = headerTexts.map((h) => h.text).join(" || ");

  // ---- dates ----
  let testDate = null;
  let dateSource = null;
  const dm = /OBSERVATION SHEET\s*DATE\s*:?\s*:?\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/i.exec(headerBlob);
  if (dm) {
    testDate = isoDate(dm[1], dm[2], dm[3]);
    dateSource = testDate ? "sheet" : null;
  }
  if (!testDate) {
    const alt = /\bDATE\s*:?\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/i.exec(headerBlob);
    if (alt) {
      testDate = isoDate(alt[1], alt[2], alt[3]);
      dateSource = testDate ? "header" : null;
    }
  }
  const refCell = ws["T2"];
  let refDate = null;
  if (refCell) {
    if (typeof refCell.v === "number") refDate = excelSerialToIso(refCell.v);
    else {
      const rm = /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(String(refCell.v));
      if (rm) refDate = isoDate(rm[1], rm[2], rm[3]);
    }
  }
  const refFlag = clean(rawText(ws, "T3"));
  if (!testDate && refDate) {
    testDate = refDate;
    dateSource = "reference";
  }

  // ---- identity ----
  let ecNo = null;
  {
    const m =
      /EC\.?\s*NO\.?\s*:?\s*(.+?)\s+Pump\s*Model/i.exec(headerBlob) || /EC\s*NO\s*:\s*([^\s|]+(?: [A-Z]+ [A-Z]+)?)/i.exec(headerBlob);
    if (m) ecNo = clean(m[1]).replace(/\s*DATE.*$/i, "");
    if (ecNo && !/[A-Za-z0-9]/.test(ecNo)) ecNo = null;
  }
  const serialCell = headerTexts.find((h) => /Pump\s*Serial/i.test(h.text))?.text ?? "";
  const serialRaw = /Pump\s*Serial(?:\s*No\.?)?\s*:?\s*(.+)$/i.exec(serialCell);
  const serial = serialRaw && /[A-Za-z0-9]/.test(serialRaw[1]) ? clean(serialRaw[1]) : null;

  // ---- motor / rated values ----
  const motorCell = headerTexts.find((h) => /TEST\s*MOTOR/i.test(h.text))?.text ?? "";
  const hp = /(\d+(?:\.\d+)?)\.?\s*HP/i.exec(motorCell); // tolerates the sheets' "1.HP" typo
  const make = /MAKE\s*:?\s*([A-Za-z][A-Za-z&.\-]*)/i.exec(motorCell);
  const makeName = make && !/^(SI|VOLT|VOLTS|CT|PT|RPM)$/i.test(make[1]) ? make[1] : null;
  const motorRpm = /RPM\s*(\d{3,4})/i.exec(motorCell);
  const liquidCell = headerTexts.find((h) => /^Liquid\b/i.test(h.text))?.text ?? "";
  const liquid = /^Liquid\s+([A-Za-z ]+?)\s+(?:Sp\.?\s*Gravity|P\.)/i.exec(liquidCell)?.[1]?.trim().toUpperCase() ?? null;
  const ratedRpm = /PUMP\s*RPM\s*=?\s*(\d+(?:\.\d+)?)/i.exec(liquidCell);
  // "Motor KW/RPM = 5.5 KW /1440", "Motor HP/RPM = 2.2KW/1440", ".75KW", "=1 .1KW" -- spaces inside the number are typos.
  const ratedKwRaw = /Motor\s*(?:KW|HP)\s*\/?\s*RPM\s*=?\s*([\d. ]+?)\s*KW/i.exec(liquidCell);
  const ratedKw = ratedKwRaw && /\d/.test(ratedKwRaw[1]) && Number.isFinite(Number(ratedKwRaw[1].replace(/\s+/g, ""))) ? [null, ratedKwRaw[1].replace(/\s+/g, "")] : null;
  const headM = /\bHead\s*=?\s*([\d.]+)\s*(BAR|MWC|MLC|MTR|KG\s*\/?\s*CM\s*2?|M)\b/i.exec(liquidCell);
  const npsha = /NPSHa\s+(POSITIVE|NEGATIVE)/i.exec(liquidCell)?.[1]?.toUpperCase() ?? null;

  // Rated head is stored in KG/CM2 (the app compares it to the test points' head_kgcm2), so convert from what the
  // sheet says. The earlier import stored MWC figures unconverted -- the known "rated head unit mix-up".
  let ratedHead = null;
  if (headM) {
    const unit = headM[2].toUpperCase().replace(/[^A-Z0-9]/g, "");
    const factor = HEAD_UNIT_TO_KGCM2[unit];
    if (factor !== undefined) ratedHead = round(Number(headM[1]) * factor, 2);
    else warnings.push(`rated head unit not recognised: ${headM[2]}`);
  }

  // ---- theoretical capacity per 100 rev: a "QTH" cell (case-insensitive) and the number beside it ----
  // Sheets carry one to three of them ("QTH 0KG/CM2", "QTH 6KG/CM2", or a bare "QTH"). The earlier import used the
  // 6 KG/CM2 one when there was a choice, else the last one, rounded to 2 decimals.
  const qthCandidates = [];
  for (const a of cellsIn(ws)) {
    const { col, row } = splitAddr(a);
    if (!/^QTH\b/i.test(clean(ws[a].v)) || !COLS.includes(col)) continue;
    const start = COLS.indexOf(col);
    let six = /6\s*KG/i.test(clean(ws[a].v));
    let value = null;
    // The label, an optional "6KG/CM2" tag, and the number can be spread over several merged columns.
    for (let i = start + 1; i <= start + 8 && i < COLS.length; i++) {
      const c = ws[COLS[i] + row];
      if (!c) continue;
      if (typeof c.v === "string" && /6\s*KG/i.test(c.v)) six = true;
      const n = numberOf(c);
      if (n !== null) {
        value = n;
        break; // the first number after the label is its value
      }
    }
    if (value !== null) qthCandidates.push({ six, value });
  }
  const qthPick = qthCandidates.find((c) => c.six) ?? qthCandidates[qthCandidates.length - 1] ?? null;
  const qth = qthPick ? round(qthPick.value, 2) : null;

  // ---- V-notch baseline (Hin): the number beside an "Hin" label, any column ----
  let vnotchBaseline = null;
  for (const a of cellsIn(ws)) {
    const { col, row } = splitAddr(a);
    if (/^Hin$/i.test(clean(ws[a].v)) && COLS.includes(col)) vnotchBaseline = numberOf(ws[COLS[COLS.indexOf(col) + 1] + row]);
  }

  // ---- vibration / run / temperatures ----
  const vibAddr = findLabel(ws, /^Vibration test/i);
  const vibText = clean(rawText(ws, vibAddr));
  const sound = /Sound\s*(\d+(?:\.\d+)?)\s*Db/i.exec(vibText);
  const leadingDecimal = "(\\d*\\.?\\d+)"; // ".45" as well as "0.45"
  const vx = new RegExp("X\\s*-\\s*" + leadingDecimal, "i").exec(vibText);
  const vy = new RegExp("Y\\s*-\\s*" + leadingDecimal, "i").exec(vibText);
  const vz = new RegExp("Z\\s*-\\s*" + leadingDecimal, "i").exec(vibText);

  // Two layouts: labels in one cell with the value two columns to the right ...
  const valueTwoRight = (labelRe) => {
    const a = findLabel(ws, labelRe);
    if (!a) return null;
    const { col, row } = splitAddr(a);
    return ws[COLS[COLS.indexOf(col) + 2] + row] ?? null;
  };
  let startedAt = timeText(valueTwoRight(/^Pump started/i));
  let stoppedAt = timeText(valueTwoRight(/^Pumps? stopped/i));
  const totalRunCell = valueTwoRight(/^Total run/i);
  let totalRun = totalRunCell && totalRunCell.v !== undefined && totalRunCell.v !== "" ? clean(totalRunCell.v) : null;
  let ambient = numberOf(valueTwoRight(/^ambient temp/i));
  let bearing = numberOf(valueTwoRight(/^max\.? bearing temp/i));
  let rise = numberOf(valueTwoRight(/^Total rise/i));

  // ... or the whole run/temperature block typed as one sentence:
  // "pumps started at-4:00 PM ambient temp. 23.2 0c pumps stopped at 4:30 PM Max. Bearing temp 26.2 0c total run : 30 min . total rise 3 0c"
  if (vibAddr) {
    const { row } = splitAddr(vibAddr);
    const sentence = cellsIn(ws)
      .filter((a) => splitAddr(a).row >= row && splitAddr(a).row <= row + 1 && typeof ws[a].v === "string")
      .map((a) => clean(ws[a].v))
      .join(" ");
    const clock = "(\\d{1,2}\\s*[:.]\\s*\\d{2}\\s*[AP]\\.?M\\.?)";
    const grab = (re) => re.exec(sentence)?.[1] ?? null;
    if (!startedAt) startedAt = grab(new RegExp("started\\s*at\\s*-?\\s*" + clock, "i"))?.replace(/\s+/g, "") ?? null;
    if (!stoppedAt) stoppedAt = grab(new RegExp("stopped\\s*at\\s*-?\\s*" + clock, "i"))?.replace(/\s+/g, "") ?? null;
    if (ambient === null) ambient = Number(grab(/ambient\s*temp\.?\s*(\d+(?:\.\d+)?)/i)) || null;
    if (bearing === null) bearing = Number(grab(/bearing\s*temp\.?\s*(\d+(?:\.\d+)?)/i)) || null;
    if (rise === null) rise = grab(/total\s*rise\s*(\d+(?:\.\d+)?)/i) !== null ? Number(grab(/total\s*rise\s*(\d+(?:\.\d+)?)/i)) : null;
    if (!totalRun) totalRun = grab(/total\s*run\s*:?\s*(\d+\s*(?:min|mins|minutes|hrs?|hours)\b)/i);
  }

  // ---- points ----
  const points = [];
  const val = (row, col) => (row ? numberOf(ws[col + row]) : null);
  const ratedRpmNum = ratedRpm ? Number(ratedRpm[1]) : null;
  for (const col of pointColumns) {
    const rpm = val(rows.rpm, col);
    if (rpm === null || rpm === 0) continue; // a column with no speed reading is not a test point
    const headKg = val(rows.head, col);
    const capacity = val(rows.capacity, col); // what the sheet shows (V-notch / Barrel sheets compute it in Excel)
    const power = val(rows.power, col);
    const heightTaken = val(rows.heightTaken, col);
    const timeSec = val(rows.timeSec, col);

    const headMwc = headKg !== null ? headKg * 10 : null;
    const theoPower = capacity !== null && headMwc !== null ? (capacity * headMwc) / 367 : null;
    const theoCapMeasured = qth !== null ? (qth * rpm) / 100 : null;
    const slip = theoCapMeasured !== null && capacity !== null ? theoCapMeasured - capacity : null;
    const theoCapRated = ratedRpmNum !== null && qth !== null ? (ratedRpmNum * qth) / 100 : null;
    const capLiquid = theoCapRated !== null && slip !== null ? theoCapRated - slip : null;

    points.push({
      rpm: round(rpm, 2),
      head_kgcm2: round(headKg, 2),
      head_mwc: round(headMwc, 2),
      capacity_calculated_m3hr: round(capacity, 4),
      volts: round(val(rows.volts, col), 2),
      amps: round(val(rows.amps, col), 2),
      cos_phi: round(val(rows.cos, col), 3),
      power_calculated_kw: round(power, 6),
      theoretical_power_kw: round(theoPower, 6),
      theoretical_capacity_at_measured_rpm: round(theoCapMeasured, 4),
      slip_water: round(slip, 4),
      slip_viscous: round(slip, 4),
      theoretical_capacity_at_rated_rpm: round(theoCapRated, 4),
      capacity_liquid_at_rated_rpm_m3hr: round(capLiquid, 4),
      capacity_liquid_at_rated_rpm_lph: capLiquid !== null ? round(capLiquid * 1000, 2) : null,
      // template-specific raw inputs
      height_taken_for_filling: testType === "V-notch" ? round(heightTaken, 2) : null,
      vnotch_height: testType === "V-notch" && heightTaken !== null && vnotchBaseline !== null ? round(heightTaken - vnotchBaseline, 2) : null,
      time_taken_to_fill_bucket_sec: testType === "Barrel" ? round(timeSec, 2) : null,
    });
  }

  const report = {
    model,
    test_type: testType,
    report_format: "observation",
    capacity_unit: "M3/HR",
    head_unit: "KG/CM2",
    ec_no: ecNo,
    test_date: testDate,
    pump_serial_no: serial,
    motor: hp ? `${makeName ? makeName + " " : ""}${hp[1]}HP` : null,
    motor_rpm: motorRpm ? Number(motorRpm[1]) : null,
    liquid,
    rated_rpm: ratedRpmNum,
    rated_power_kw: ratedKw ? Number(ratedKw[1]) : null,
    rated_head: ratedHead,
    q_theoretical_100rev: qth,
    npsha_status: npsha,
    vnotch_baseline: testType === "V-notch" ? vnotchBaseline : null,
    vibration_sound_db: sound ? Number(sound[1]) : null,
    vibration_x_mm_sec: vx ? Number(vx[1]) : null,
    vibration_y_mm_sec: vy ? Number(vy[1]) : null,
    vibration_z_mm_sec: vz ? Number(vz[1]) : null,
    pump_started_at: startedAt,
    pump_stopped_at: stoppedAt,
    total_run: totalRun,
    ambient_temp_c: round(ambient, 2),
    max_bearing_temp_c: round(bearing, 2),
    total_rise_c: round(rise, 2),
  };

  if (!points.length) warnings.push("no test points found");
  if (!testDate) warnings.push("no test date found");
  return { report, points, warnings, meta: { dateSource, refDate, refFlag, rows } };
}
