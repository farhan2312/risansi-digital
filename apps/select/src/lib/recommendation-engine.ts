/**
 * PCP pump recommendation engine — ported line-for-line from
 * azure-functions/shared/recommendation_engine.py.
 *
 * Implements the flow chart in flow chart.xlsx / Formula.docx / the Amit
 * Sharma, Kamini and Rachna docs. Only pump_family='PCP' is supported — ROTA is
 * out of scope for this phase.
 *
 * This is an engineering estimation tool, not a certified calculation — tested
 * figures are always preferred over calculated ones, and every calculated
 * figure is tagged as such in the response so a sales engineer can see what's
 * a real test result vs an estimate.
 *
 * NOTE: `pg` returns NUMERIC columns as strings; every numeric master value is
 * read through `toNum` before use.
 *
 * Only Step-3 model screening (this file's `findCandidates`) is wired up right
 * now. MOC resolution, sealing resolution, suction/discharge sizing, motor-kW
 * rounding, viscosity correction, RPM-band lookup, and the full selection
 * report were removed because their master tables (moc_selection_guide,
 * sealing_selection_rule, suction_velocity, standard_motor_kw, ve_correction,
 * rpm_band_master, moc_master) and the persistence tables (pump_selections,
 * pump_recommendations) don't exist in the DB yet — keeping that code in would
 * fail the production build the moment any of those tables were dropped from
 * schema.ts. Re-add each piece once its master table is built.
 */
import { and, eq } from "drizzle-orm";

import { db as defaultDb } from "./db";
import * as schema from "./db/schema";

type Db = typeof defaultDb;

function toNum(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isNaN(n) ? fallback : n;
}

function toNumOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isNaN(n) ? null : n;
}

// --- Unit conversion -------------------------------------------------------

export function toM3PerHr(value: number, unit: string | null, sg: number): number {
  const u = (unit || "M3/hr").trim();
  if (u === "M3/hr") return value;
  if (u === "LPH") return value / 1000;
  if (u === "LPM") return value * 0.06; // litres/min: x 60 min / 1000 L
  if (u === "GPM") return value * 0.227125; // US gallons/min
  if (u === "KLPD") return value / 24; // kiloliters/day
  if (u === "TPH") return value / (sg || 1.0); // tons/hr, needs density
  return value;
}

export function toMwc(value: number, unit: string | null, sg: number): number {
  const u = (unit || "MWC").trim();
  if (u === "MWC") return value;
  // Per "Backend Formulas Required" spec, Step-2: MWC = MLC * Specific Gravity.
  if (u === "MLC") return value * (sg || 1.0);
  // Per spec, Step-2: "Head = Pressure * 10" for both Bar and Kg/cm2.
  if (u === "Bar") return value * 10.0;
  if (u === "Kg/cm2" || u === "Kg/cm²") return value * 10.0;
  return value;
}

export function toCp(value: number, unit: string | null, sg: number): number {
  const u = (unit || "cP").trim();
  if (u === "cSt") return value * (sg || 1.0);
  return value;
}

// RPM bands live in lib/rpm-bands.ts — no DB imports, so client components can
// read the labels without pulling this engine (and the schema) into the bundle.
// Re-exported here because callers already import classifyRpm from the engine.
export { classifyRpm, RPM_BANDS, rpmBandByKey, rpmBandFor, rpmBandOverlaps } from "./rpm-bands";
import { classifyRpm } from "./rpm-bands";

// --- Drive helpers (not yet wired into a wizard step — no motor-speed input
// flows through findCandidates right now; kept for the future Drive Details
// step, since neither function depends on any DB table). ---------------------

export function reductionRatio(
  motorRpm: number | null,
  rpmRequired: number,
): number | null {
  if (!motorRpm || rpmRequired <= 0) return null;
  return motorRpm / rpmRequired;
}

export function resolveDrive(rpmRequired: number, motorRpm: number | null): string {
  const ratio = reductionRatio(motorRpm, rpmRequired);
  if (ratio === null) return "Geared Motor";
  if (ratio >= 0.9 && ratio <= 1.1) return "Direct Drive";
  // V-belt/pulley reduction is practical up to roughly 6:1; beyond that a
  // gearbox is the realistic option (engineering rule of thumb, flagged).
  if (ratio > 1 && ratio <= 6) return "V-Belt Drive";
  return "Geared Motor";
}

// PCP head bands by stage — the non-overlapping MWC range each stage covers.
// These ARE the thresholds `requiredStage` uses to map an input head to a
// stage (≤60 = 1, 60–120 = 2, 120–240 = 4, 240–480 = 8); kept as one map so
// the UI can show a model's head as its stage band (e.g. "0–60 MWC") without
// re-deriving the boundaries. Every model in a stage is charted 0→ceiling in
// the master data, but the band's LOWER bound is the previous stage's ceiling
// — that's the head range the stage is actually selected for.
export const STAGE_HEAD_BANDS: Record<number, [number, number]> = {
  1: [0, 60],
  2: [60, 120],
  4: [120, 240],
  8: [240, 480],
};

/** "0–60" / "60–120" / … for a stage, or null when the stage is unknown. */
export function headBandLabel(stage: number | null): string | null {
  if (stage == null) return null;
  const band = STAGE_HEAD_BANDS[stage];
  return band ? `${band[0]}–${band[1]}` : null;
}

export interface Candidate {
  model: string;
  /** Pump stage count (1/2/4/8), derived from the model name (2H*=2, 4H*=4, bare H*=1). */
  stage: number | null;
  /** Nearest charted head point (in pump_model_master) to the input duty head. */
  headMwc: number;
  /** NULL when this model has no charted VOLE/QTH at the matched head — the
   * model is still listed (stage-only inclusion), just with blank performance
   * figures and no computable RPM. */
  voleMin: number | null;
  voleMax: number | null;
  mechEff: number | null;
  qth: number | null;
  /** True if this model has no "NOT TESTED" remark at the matched head. */
  isTested: boolean;
  testingRemarks: string | null;
  /** RPM computed using VOLE MIN (lower efficiency ⇒ the higher-speed case).
   * NULL when QTH/VOLE data is missing (can't compute). */
  rpmAtVoleMin: number | null;
  /** RPM computed using VOLE MAX (higher efficiency ⇒ the lower, best-case speed). */
  rpmAtVoleMax: number | null;
  /** RPM window used to screen against the manual RPM band: the widest window
   *  across the head points actually offered on the card (a model is a match
   *  when ANY head it can be run at reaches the band). Falls back to the
   *  nearest-head window when no head point has one. */
  screenRpmLo: number | null;
  screenRpmHi: number | null;
  rpmClassAtVoleMin: string | null;
  rpmClassAtVoleMax: string | null;
  /** Max hard-solid particle size this model can pass (mm), or null if unrecorded. */
  hardSolidMm: number | null;
  /** Max soft-solid particle size this model can pass (mm), or null if unrecorded. */
  softSolidMm: number | null;
  /** Suction/discharge pipe size (inches) per viscosity band, from
   * pump_model_master's size_visc_* columns (sourced from
   * Model_vs_Viscosity_vs_Size.xlsx). NULL when this model isn't covered by
   * the source sheet — the model then has no recommended size. */
  sizeVisc0To1000In: number | null;
  sizeVisc1000To3000In: number | null;
  sizeVisc3000To5000In: number | null;
  sizeVisc5000To10000In: number | null;
  sizeViscGt10000In: number | null;
  /** The two charted head points bracketing the duty head — nearest below +
   * nearest at/above — each with its own VOLE/Mech-Eff/RPM. Lets the UI offer
   * the pump at the heads either side of the duty (e.g. 20 & 30 for a 26 MWC
   * duty), not the whole curve. One entry only when the duty is on/beyond an
   * end of the charted range. */
  headPoints: HeadPoint[];
}

/** One charted head point of a model's performance curve. RPM is computed at
 * this head (same formula as the duty-point fields), so each row is a real
 * operating point rather than an interpolation. */
export interface HeadPoint {
  headMwc: number;
  voleMin: number | null;
  voleMax: number | null;
  mechEff: number | null;
  qth: number | null;
  /** "VOLE-max rpm–VOLE-min rpm" at this head, or "—" when not computable. */
  rpmRange: string;
  /** The same window as numbers (best-case low / high speed), or null. */
  rpmLo: number | null;
  rpmHi: number | null;
}

type ModelRow = typeof schema.pumpModelMaster.$inferSelect;

/** RPM range string ("lo–hi" / "lo" / "—") at one head row, from the same
 * RPM = 100·Q / (QTH·VE) formula used for the duty point. */
/** The pump's required RPM window at ONE charted head. This is the single
 * definition of that window: the head cards in the Fluid step display it (via
 * rpmRangeAt) and the V-Belt / gearbox screening filters against it (via
 * computePumpRpmWindow), so both must come from here — and from the SAME head
 * — or the drive steps would screen against a window the user never saw. */
function rpmWindowFrom(
  capacityM3hr: number,
  qth: number | null,
  voleMin: number | null,
  voleMax: number | null,
): { lo: number; hi: number } | null {
  const ok =
    qth !== null && qth > 0 &&
    voleMin !== null && voleMin > 0 &&
    voleMax !== null && voleMax > 0;
  if (!ok) return null;
  return {
    lo: (100 * capacityM3hr) / (qth! * (voleMax! / 100)), // best case (low rpm)
    hi: (100 * capacityM3hr) / (qth! * (voleMin! / 100)), // high rpm
  };
}

function rpmRangeAt(
  capacityM3hr: number,
  qth: number | null,
  voleMin: number | null,
  voleMax: number | null,
): string {
  const w = rpmWindowFrom(capacityM3hr, qth, voleMin, voleMax);
  if (!w) return "—";
  const lo = Math.round(w.lo);
  const hi = Math.round(w.hi);
  return hi > lo ? `${lo}–${hi}` : `${lo}`;
}

/**
 * Step-3 model screening: given a duty point (capacity + head), scans
 * pump_model_master and returns EVERY model that can physically satisfy it —
 * no scoring, no ranking, no top-N cutoff. Per the spec: "system should give
 * all the model that satisfy the inputs... recommendation can be manual
 * selection" — the sales engineer picks the final model from this list.
 *
 * RPM formula (per the Step-3 spec): RPM = Q ÷ (Displacement × VE). QTH in
 * pump_model_master is this model's theoretical flow at a 100 RPM reference
 * speed rather than a literal per-revolution displacement, so
 * Displacement ≡ QTH / 100 and the formula becomes RPM = 100 × Q / (QTH × VE)
 * — the same ratio, just expressed against this sheet's QTH convention.
 * Two RPMs are returned per model, one per VOLE bound — the sheet's "2
 * output RPMs as per VE": VOLE MIN (lower efficiency ⇒ higher required
 * speed) and VOLE MAX (higher efficiency ⇒ lower, best-case speed).
 *
 * Optional solid-handling filter: if solidSizeMm + solidType are both given,
 * a model is excluded unless its recorded hard/soft-solid capacity (per
 * solidType) EXACTLY EQUALS solidSizeMm — the source sheet's values are a
 * fixed set of standard size classes, not a continuous minimum spec, so a
 * larger-rated model is not a valid substitute for a smaller entered size.
 * Models with no recorded capacity for that solid type are excluded too
 * (conservative — can't confirm suitability, per user decision) rather than
 * passed through unfiltered.
 */
export async function findCandidates(
  db: Db,
  capacityM3hr: number,
  headMwc: number,
  solidSizeMm: number | null = null,
  solidType: string | null = null,
): Promise<Candidate[]> {
  const rows = await db.select().from(schema.pumpModelMaster);

  const byModel = new Map<string, ModelRow[]>();
  for (const r of rows) {
    const list = byModel.get(r.model) ?? [];
    list.push(r);
    byModel.set(r.model, list);
  }

  const candidates: Candidate[] = [];
  for (const [modelName, points] of byModel) {
    const nearest = points.reduce((best, p) =>
      Math.abs(toNum(p.headMwc) - headMwc) < Math.abs(toNum(best.headMwc) - headMwc) ? p : best,
    );

    // VOLE/QTH may be absent for a model at the matched head. Stage-only
    // inclusion (per product decision): a model is NOT dropped for missing
    // performance data — it's still listed with blank figures and no
    // computable RPM. Only the stage band (and the optional solid filter
    // below) decide membership.
    const qth = toNumOrNull(nearest.qth);
    const voleMinPct = toNumOrNull(nearest.voleMin);
    const voleMaxPct = toNumOrNull(nearest.voleMax);

    // Stage-tier constraint: PCP models come in non-overlapping head bands by
    // stage count (backend spec Step-4): <=60 MWC = single, 60-120 = 2-stage,
    // 120-240 = 4-stage, 240-480 = 8-stage. The head alone picks the band, and
    // EVERY model in that band is shown — capacity/RPM never remove a model
    // from the list (they only feed the informational RPM figures below and
    // the optional manual RPM-range filter in the route). Uses the model's own
    // `stage` column (name-derived — see schema.ts).
    const requiredStage = headMwc <= 60 ? 1 : headMwc <= 120 ? 2 : headMwc <= 240 ? 4 : 8;
    const stage = nearest.stage;
    if (stage !== requiredStage) continue; // Reject Model / Try Next Model

    // Hard/soft-solid capacity is a MODEL-level attribute — the same value on
    // every head-row of a model (applied uniformly when solid.xlsx was
    // seeded) — not something that varies by head, so it must NOT be read off
    // `nearest` (which is selected purely by head-proximity to the input duty
    // point). Scan the model's own rows directly instead.
    const hardSolidMm = toNumOrNull(points.find((p) => p.hardSolidMm !== null)?.hardSolidMm ?? null);
    const softSolidMm = toNumOrNull(points.find((p) => p.softSolidMm !== null)?.softSolidMm ?? null);

    // Suction/discharge pipe sizes per viscosity band — model-level (same on
    // every head-row of the model, forward-fill pattern), so read off any
    // populated row rather than `nearest`.
    const sizeVisc0To1000In = toNumOrNull(points.find((p) => p.sizeVisc0To1000In !== null)?.sizeVisc0To1000In ?? null);
    const sizeVisc1000To3000In = toNumOrNull(points.find((p) => p.sizeVisc1000To3000In !== null)?.sizeVisc1000To3000In ?? null);
    const sizeVisc3000To5000In = toNumOrNull(points.find((p) => p.sizeVisc3000To5000In !== null)?.sizeVisc3000To5000In ?? null);
    const sizeVisc5000To10000In = toNumOrNull(points.find((p) => p.sizeVisc5000To10000In !== null)?.sizeVisc5000To10000In ?? null);
    const sizeViscGt10000In = toNumOrNull(points.find((p) => p.sizeViscGt10000In !== null)?.sizeViscGt10000In ?? null);

    // Solid-handling filter: only engages when BOTH a size and a type are
    // given (need the type to know which column applies). A model is kept if
    // its recorded capacity for that solid type is >= the entered size — the
    // rating is the largest particle the model can pass, so anything at or
    // above the duty size qualifies (a 35.56mm-rated model can handle a
    // 30.48mm duty). Rounded to 2dp to avoid float-precision surprises on the
    // numeric(6,2) column. Models with no recorded capacity for that type are
    // excluded (conservative — can't confirm suitability).
    if (solidSizeMm !== null && solidSizeMm > 0 && solidType) {
      const capacity = solidType === "Hard Solid" ? hardSolidMm : solidType === "Soft Solid" ? softSolidMm : null;
      const ok = capacity !== null && Math.round(capacity * 100) >= Math.round(solidSizeMm * 100);
      if (!ok) continue;
    }

    // RPM = 100 x Capacity / (QTH x VE). See formula note above. Only
    // computable when the model has valid QTH + VOLE at this head; left NULL
    // (blank in the UI) otherwise. No sanity cutoff — an out-of-range RPM no
    // longer removes the model from its stage list; it's an informational
    // figure only.
    const canComputeRpm =
      qth !== null && qth > 0 &&
      voleMinPct !== null && voleMinPct > 0 &&
      voleMaxPct !== null && voleMaxPct > 0;
    const rpmAtVoleMax = canComputeRpm ? (100 * capacityM3hr) / (qth! * (voleMaxPct! / 100)) : null;
    const rpmAtVoleMin = canComputeRpm ? (100 * capacityM3hr) / (qth! * (voleMinPct! / 100)) : null;

    // Per-head performance rows — one per charted head point, ascending, each
    // with its own VOLE/Mech-Eff/Qth and RPM at that head.
    const allHeadPoints: HeadPoint[] = points
      .map((p) => {
        const vMin = toNumOrNull(p.voleMin);
        const vMax = toNumOrNull(p.voleMax);
        const q = toNumOrNull(p.qth);
        return {
          headMwc: toNum(p.headMwc),
          voleMin: vMin,
          voleMax: vMax,
          mechEff: toNumOrNull(p.mechEff),
          qth: q,
          rpmRange: rpmRangeAt(capacityM3hr, q, vMin, vMax),
          rpmLo: rpmWindowFrom(capacityM3hr, q, vMin, vMax)?.lo ?? null,
          rpmHi: rpmWindowFrom(capacityM3hr, q, vMin, vMax)?.hi ?? null,
        };
      })
      .sort((a, b) => a.headMwc - b.headMwc);

    // Which heads are valid OPERATING heads for this stage, then the two that
    // bracket the duty. Rules:
    //  1. Restrict to the stage's own band — exclude the lower boundary that
    //     overlaps the previous stage. Stage 2 covers >60 MWC, so its 0–60
    //     rows (and the shared 60 point) aren't valid here; likewise stage 4
    //     excludes ≤120. Stage 1's lower bound is 0, a real head, so it stays.
    //  2. If the duty EXACTLY matches a charted head, return just that head —
    //     no below/above straddle (e.g. a 30 MWC duty offers only 30).
    //  3. Otherwise return the nearest charted head below the duty and the
    //     nearest above it (e.g. 26 MWC → 20 and 30). When one side has no
    //     valid head (duty near a band edge), only the available side returns.
    const bandLo = STAGE_HEAD_BANDS[stage ?? 0]?.[0] ?? 0;
    const inBand = allHeadPoints.filter((p) => bandLo === 0 || p.headMwc > bandLo);
    const exact = inBand.find((p) => Math.abs(p.headMwc - headMwc) < 1e-9);
    const headPoints: HeadPoint[] = exact
      ? [exact]
      : [
          [...inBand].reverse().find((p) => p.headMwc < headMwc),
          inBand.find((p) => p.headMwc > headMwc),
        ].filter((p): p is HeadPoint => p != null);

    // Screening window across the offered heads (see screenRpmLo above).
    const pointWindows = headPoints.filter((p) => p.rpmLo !== null && p.rpmHi !== null);
    const screenRpmLo = pointWindows.length
      ? Math.min(...pointWindows.map((p) => p.rpmLo!))
      : rpmAtVoleMax;
    const screenRpmHi = pointWindows.length
      ? Math.max(...pointWindows.map((p) => p.rpmHi!))
      : rpmAtVoleMin;

    candidates.push({
      model: modelName,
      stage,
      headMwc: toNum(nearest.headMwc),
      voleMin: voleMinPct,
      voleMax: voleMaxPct,
      mechEff: toNumOrNull(nearest.mechEff),
      qth,
      isTested: nearest.testingRemarks === null,
      testingRemarks: nearest.testingRemarks,
      rpmAtVoleMin,
      rpmAtVoleMax,
      screenRpmLo,
      screenRpmHi,
      rpmClassAtVoleMin: rpmAtVoleMin !== null ? classifyRpm(rpmAtVoleMin) : null,
      rpmClassAtVoleMax: rpmAtVoleMax !== null ? classifyRpm(rpmAtVoleMax) : null,
      hardSolidMm,
      softSolidMm,
      sizeVisc0To1000In,
      sizeVisc1000To3000In,
      sizeVisc3000To5000In,
      sizeVisc5000To10000In,
      sizeViscGt10000In,
      headPoints,
    });
  }

  // Informational ordering only (lowest best-case speed first — PCP pumps
  // run best slow) — NOT a cutoff. Every eligible model above is returned;
  // the caller does no top-N slicing, since selection is manual. Models with
  // no computable RPM (missing VOLE/QTH) sort to the end.
  candidates.sort((a, b) => {
    if (a.rpmAtVoleMax === null) return b.rpmAtVoleMax === null ? 0 : 1;
    if (b.rpmAtVoleMax === null) return -1;
    return a.rpmAtVoleMax - b.rpmAtVoleMax;
  });

  return candidates;
}

// --- Motor rating (KW) --------------------------------------------------------

export interface MotorRating {
  model: string;
  /** The charted head that mechanical efficiency and Min KW tested were read
   * from: the head selected for this model when there is one, else the charted
   * head nearest the duty. It is NOT the head the BKW formula uses. */
  headMwc: number;
  /** The duty head the BKW formula actually uses: the head entered on General
   * Information, converted to MWC. Surfaced so the calculation panel can name
   * the real input instead of the charted lookup point. */
  dutyHeadMwc: number;
  /** Mechanical efficiency (%) at the duty head for the selected model. */
  mechEff: number;
  /** BKW = Capacity × Head / 367 / (ME/100). Null if ME is 0/absent. */
  bkw: number | null;
  /** Motor KW = BKW × 1.2 (safety margin). Null if BKW is null. */
  motorKw: number | null;
  /** Cap: the model's "Min KW so far tested". Null if not recorded. */
  minKwTested: number | null;
  /** EVERY standard motor KW rating (from motor_rating), for manual override —
   *  not just the ones above Motor KW. `recommendedKw` still marks the
   *  adequate-with-margin size. */
  kwOptions: number[];
  /** Nearest standard KW (from kwOptions) >= Motor KW (or the largest
   *  available if none reach it) - one rating higher for a 4-stage pump. */
  recommendedKw: number | null;
  /** The model's stage count (1, 2, 4, 8), from pump_model_master. */
  stage: number | null;
  /** Set when the 4-stage step-up was applied: the size the load alone would
   *  have been recommended (recommendedKw is the next standard rating up). */
  steppedUpFromKw: number | null;
  /** Set when the model's fixed minimum (MIN_RECOMMENDED_KW) raised the
   *  recommendation: the size it would otherwise have been. */
  raisedToMinFromKw: number | null;
  /** True when recommendedKw exceeds minKwTested — recommend it anyway, but flag. */
  exceedsMinTested: boolean;
}

/** Per-model minimum motor rating (kW): the recommendation never goes below
 *  it, whatever the duty. A house rule for specific models, not derived from
 *  the pump master. */
export const MIN_RECOMMENDED_KW: Record<string, number> = {
  H40L6: 1.5,
};

/**
 * Motor Rating KW calculation (wizard step after MOC). Per the spec:
 *   ME  = selected model's mechanical efficiency at the duty head
 *   BKW = Capacity × Head / 367 / (ME/100)          ("BKW as per tested ME")
 *   Motor KW = BKW × 1.20                            (safety margin)
 *   Recommendation = nearest next-highest standard KW rating (from
 *     motor_rating) that is >= Motor KW; normally within "Min KW so far
 *     tested", but if the load needs more than that cap the recommendation is
 *     shown anyway and flagged (exceedsMinTested). The dropdown offered for
 *     manual override lists EVERY standard KW rating — including sizes at or
 *     below Motor KW — since the final call is the engineer's; the
 *     recommendation is marked in the list rather than enforced by hiding the
 *     alternatives.
 *   4-stage pumps: the recommendation goes one standard rating higher than
 *     the load needs (e.g. 0.75 -> 1.1 kW), per house rule.
 * Final KW selection is manual, from the dropdown.
 */
export async function computeMotorRating(
  db: Db,
  model: string,
  capacityM3hr: number,
  headMwc: number,
  /** The charted head the engineer selected for this model on the
   * recommendation card. Sources ME / Min KW tested; the BKW formula still
   * uses the entered duty head above. Null/absent falls back to the charted
   * head nearest the duty. */
  selectedHeadMwc?: number | null,
): Promise<MotorRating | null> {
  const rows = await db
    .select()
    .from(schema.pumpModelMaster)
    .where(eq(schema.pumpModelMaster.model, model));
  if (rows.length === 0) return null;

  // Which charted row supplies ME / Min-KW-tested. The head the engineer
  // picked on the recommendation card IS one of the charted heads, so when it
  // is known that exact row is used — otherwise the step would quote a
  // different efficiency than the card the pump was chosen from. Only when no
  // head was picked do we fall back to the row nearest the duty head.
  const nearestToDuty = rows.reduce((best, p) =>
    Math.abs(toNum(p.headMwc) - headMwc) < Math.abs(toNum(best.headMwc) - headMwc) ? p : best,
  );
  const atSelected =
    selectedHeadMwc !== null && selectedHeadMwc !== undefined
      ? rows.find((p) => Math.abs(toNum(p.headMwc) - selectedHeadMwc) < 1e-9) ?? null
      : null;
  const nearest = atSelected ?? nearestToDuty;

  const mechEff = toNum(nearest.mechEff);
  const minKwTested = toNumOrNull(nearest.minKwTested);

  let bkw: number | null = null;
  let motorKw: number | null = null;
  if (mechEff > 0) {
    bkw = (capacityM3hr * headMwc) / 367 / (mechEff / 100);
    motorKw = bkw * 1.2;
  }

  const ratingRows = await db.select({ kw: schema.motorRating.kw }).from(schema.motorRating);
  const allKw = [...new Set(ratingRows.map((r) => toNum(r.kw)).filter((k) => k > 0))].sort(
    (a, b) => a - b,
  );
  // EVERY standard rating is offered (per user decision) — the dropdown is a
  // manual override, so the engineer can also pick a size at or below Motor KW
  // when they have a reason to. The adequate-with-margin size is still marked
  // as `recommendedKw` below, so the guidance survives without the hard cut.
  const kwOptions = allKw;

  const stage = toNumOrNull(nearest.stage);
  let recommendedKw: number | null = null;
  let steppedUpFromKw: number | null = null;
  let raisedToMinFromKw: number | null = null;
  let exceedsMinTested = false;
  if (motorKw !== null && kwOptions.length > 0) {
    // Nearest standard size that meets the load with its safety margin; if
    // none reach it, the largest available (best effort — the caller/UI can
    // flag under-sizing).
    recommendedKw = kwOptions.find((k) => k >= motorKw) ?? kwOptions[kwOptions.length - 1];
    // House rule: a 4-stage pump gets one standard rating more than the load
    // needs (0.75 -> 1.1, 1.1 -> 1.5, …). At the top of the list there is
    // nothing higher, so it stays.
    if (stage === 4) {
      const next = kwOptions.find((k) => k > recommendedKw!);
      if (next !== undefined) {
        steppedUpFromKw = recommendedKw;
        recommendedKw = next;
      }
    }
    // Model floor (e.g. H40L6 never below 1.5 kW), applied last so it also
    // covers a 4-stage step-up that still lands below it.
    const floorKw = MIN_RECOMMENDED_KW[model.replace(/\s+/g, "").toUpperCase()];
    if (floorKw !== undefined && recommendedKw < floorKw) {
      raisedToMinFromKw = recommendedKw;
      recommendedKw = kwOptions.find((k) => k >= floorKw) ?? floorKw;
    }
    if (minKwTested !== null && recommendedKw > minKwTested) exceedsMinTested = true;
  }

  return {
    model,
    headMwc: toNum(nearest.headMwc),
    dutyHeadMwc: headMwc,
    mechEff,
    bkw,
    motorKw,
    minKwTested,
    kwOptions,
    recommendedKw,
    stage,
    steppedUpFromKw,
    raisedToMinFromKw,
    exceedsMinTested,
  };
}

// --- V-Belt drive recommendation ---------------------------------------------

export interface VBeltOption {
  targetRpm: number;
  /** Driven (pump) pulley — the larger one in a speed reduction. */
  pumpPulley: number | null;
  /** Driving (motor) pulley. */
  motorPulley: number | null;
  /** Resulting pump speed for this pulley pair (the real achieved RPM). */
  actualRpm: number | null;
  centerDistance: number | null;
  /** V-belt reference number from the pulley master sheet. */
  vBelt: number | null;
}

export interface VBeltDrive {
  model: string;
  motorRpm: number;
  motorKw: number;
  /** Belt groove code for the matched motor option (e.g. "3B"). */
  grooves: string | null;
  /** Pump's required speed window at the duty point (from its VE band). */
  rpmLo: number;
  rpmHi: number;
  /** Belt options to show as recommendation cards: every option whose
   *  achieved speed falls inside [rpmLo, rpmHi] — or, if none do, just the
   *  single nearest option as a "next best" fallback. No auto-pick beyond
   *  that; final selection is manual, same as pump model screening. */
  candidates: VBeltOption[];
  /** True when `candidates` are genuine in-range matches; false means it's
   *  the next-best fallback (no belt landed inside the window). */
  withinRange: boolean;
  /** Every belt option for the matched motor option, unfiltered. */
  options: VBeltOption[];
}

interface PumpRpmWindow {
  rpmLo: number;
  rpmHi: number;
}

/**
 * The pump's required output-speed window at a duty point, derived from its
 * VE band: RPM = 100 × Q / (QTH × VE). Higher VE ⇒ lower speed, so VOLE MAX
 * gives the low end of the window and VOLE MIN the high end. Shared by every
 * drive-selection calculation (V-Belt, Gearbox) that needs to match a duty
 * point against a catalog's discrete speed options.
 */
async function computePumpRpmWindow(
  db: Db,
  model: string,
  headMwc: number,
  capacityM3hr: number,
  /** The charted head selected for this model in the Fluid step. That choice
   * already fixed the RPM window — the head card displays it — so the drive
   * screening reads the SAME row rather than re-deriving at whichever head
   * happens to sit nearest the duty. Null/absent keeps the old
   * nearest-to-duty behaviour (nothing picked yet). */
  selectedHeadMwc?: number | null,
): Promise<PumpRpmWindow | null> {
  const rows = await db
    .select()
    .from(schema.pumpModelMaster)
    .where(eq(schema.pumpModelMaster.model, model));
  if (rows.length === 0) return null;

  const nearestToDuty = rows.reduce((best, p) =>
    Math.abs(toNum(p.headMwc) - headMwc) < Math.abs(toNum(best.headMwc) - headMwc) ? p : best,
  );
  const atSelected =
    selectedHeadMwc !== null && selectedHeadMwc !== undefined
      ? rows.find((p) => Math.abs(toNum(p.headMwc) - selectedHeadMwc) < 1e-9) ?? null
      : null;
  const row = atSelected ?? nearestToDuty;

  const w = rpmWindowFrom(
    capacityM3hr,
    toNumOrNull(row.qth),
    toNumOrNull(row.voleMin),
    toNumOrNull(row.voleMax),
  );
  if (!w) return null;
  return { rpmLo: w.lo, rpmHi: w.hi };
}

/**
 * V-Belt drive selection (Drive Details step, only when Drive System =
 * "V-Belt Drive"). Per the spec: after the motor RPM (960/1440) is chosen,
 * take the selected model + its motor KW (from the Motor Rating step) to find
 * the matching pulley/belt set, then screen every belt option against the
 * pump's required RPM window [rpmLo, rpmHi] (derived from the model's VE band
 * at the duty point, same formula as findCandidates). The pulley master
 * offers discrete belt ratios (target RPMs 180/220/260/300/…); every option
 * landing inside the window is returned as a candidate for manual selection —
 * if none land inside it, the nearest option BELOW the window and the nearest
 * ABOVE it are returned instead (whichever exist) as the next best, for the
 * engineer to choose (withinRange=false).
 */
export async function computeVBeltDrive(
  db: Db,
  model: string,
  capacityM3hr: number,
  headMwc: number,
  motorRpm: number,
  motorKw: number,
  /** Charted head selected for this model in the Fluid step - fixes the RPM
   * window (see computePumpRpmWindow). */
  selectedHeadMwc: number | null = null,
): Promise<VBeltDrive | null> {
  const window = await computePumpRpmWindow(db, model, headMwc, capacityM3hr, selectedHeadMwc);
  if (!window) return null;
  const { rpmLo, rpmHi } = window;

  // Match the motor option by (model, motorRpm, motorKw). motor_kw is a pg
  // NUMERIC (string) — compare numerically, not by string equality.
  const motorOptions = await db
    .select()
    .from(schema.pulleyMotorOption)
    .where(
      and(
        eq(schema.pulleyMotorOption.model, model),
        eq(schema.pulleyMotorOption.motorRpm, motorRpm),
      ),
    );
  const motorOption = motorOptions.find(
    (m) => Math.abs(toNum(m.motorKw) - motorKw) < 0.001,
  );
  if (!motorOption) {
    // No pulley data for this model/rpm/kw combination.
    return {
      model,
      motorRpm,
      motorKw,
      grooves: null,
      rpmLo,
      rpmHi,
      candidates: [],
      withinRange: false,
      options: [],
    };
  }

  const beltRows = await db
    .select()
    .from(schema.pulleyBeltOption)
    .where(eq(schema.pulleyBeltOption.pulleyMotorOptionId, motorOption.id));

  const options: VBeltOption[] = beltRows
    .map((b) => ({
      targetRpm: toNum(b.targetRpm),
      pumpPulley: toNumOrNull(b.pmpPulley),
      motorPulley: toNumOrNull(b.mtrPulley),
      actualRpm: toNumOrNull(b.actualRpm),
      centerDistance: toNumOrNull(b.centerDistance),
      vBelt: toNumOrNull(b.vBelt),
    }))
    .sort((a, b) => (a.actualRpm ?? a.targetRpm) - (b.actualRpm ?? b.targetRpm));

  // Compare against the real achieved speed (actual RPM), falling back to the
  // nominal target RPM if a row somehow lacks an actual figure.
  const speed = (o: VBeltOption) => o.actualRpm ?? o.targetRpm;

  // Every belt whose pump speed lands inside the window is a candidate — no
  // single auto-pick, selection is manual (per spec, same as pump model
  // screening). If none land inside it, offer the next lower and the next
  // higher speed either side of the window (user, 2026-10-03), so the
  // engineer chooses between slightly under and slightly over.
  const inRange = options.filter((o) => speed(o) >= rpmLo && speed(o) <= rpmHi);
  let candidates: VBeltOption[] = [];
  let withinRange = false;
  if (inRange.length > 0) {
    candidates = inRange; // already sorted ascending by speed
    withinRange = true;
  } else if (options.length > 0) {
    // options are sorted ascending by speed.
    const below = options.filter((o) => speed(o) < rpmLo).at(-1);
    const above = options.find((o) => speed(o) > rpmHi);
    candidates = [below, above].filter((o): o is VBeltOption => o !== undefined);
    withinRange = false;
  }

  return {
    model,
    motorRpm,
    motorKw,
    grooves: motorOption.grooves,
    rpmLo,
    rpmHi,
    candidates,
    withinRange,
    options,
  };
}

// --- Gearbox drive recommendation (PBL / PTL / Top Gear) --------------------

export interface GearboxOption {
  id: string;
  powerRatingRaw: string;
  powerRatingKw: number | null;
  outputRpm: number;
  model: string;
  gearBoxType: string | null;
  serviceFactor: number | null;
  ratePerNos: number | null;
}

export interface GearboxRecommendation {
  model: string;
  motorKw: number;
  /** Pump's required speed window at the duty point (from its VE band). */
  rpmLo: number;
  rpmHi: number;
  /** rpmLo/rpmHi widened ±20% — catalog gearboxes only offer discrete output
   *  RPMs, so a hard window would exclude every option. This is the window
   *  candidates are actually screened against. */
  rpmLoPadded: number;
  rpmHiPadded: number;
  pbl: GearboxOption[];
  ptl: GearboxOption[];
  topGear: GearboxOption[];
}

// ASF Range bands, matching the Drive Details step's ASF Range dropdown.
const ASF_BANDS: Record<string, [number, number]> = {
  "1.4-2": [1.4, 2],
  "2+": [2, Infinity],
};

type GearboxRow = {
  id: string;
  powerRatingRaw: string;
  powerRatingKw: string | null;
  outputRpm: string;
  model: string;
  gearBoxType: string | null;
  serviceFactor: string | null;
  ratePerNos: string | null;
};

function toGearboxOption(row: GearboxRow): GearboxOption {
  return {
    id: row.id,
    powerRatingRaw: row.powerRatingRaw,
    powerRatingKw: toNumOrNull(row.powerRatingKw),
    outputRpm: toNum(row.outputRpm),
    model: row.model,
    gearBoxType: row.gearBoxType,
    serviceFactor: toNumOrNull(row.serviceFactor),
    ratePerNos: toNumOrNull(row.ratePerNos),
  };
}

/**
 * Gearbox drive recommendation (Drive Details step, only when Drive System =
 * Geared Motor Drive/Gear Box + Motor). Per spec: candidates are screened
 * from the PBL / PTL / Top Gear masters by (a) the pump's required RPM
 * window (VE-band derived, same calc as V-Belt) widened ±20% — the catalogs
 * only offer discrete output RPMs, so a hard window would exclude everything
 * — and (b) an exact match on the motor KW chosen on the Motor Rating step.
 * ASF Range and GB Type are optional additional filters that narrow the
 * already-screened list once the user picks them on this step, rather than
 * gating the initial screen — selection stays fully manual, same as pump
 * model screening (no auto-pick/ranking, every match is returned).
 */
export async function findGearboxOptions(
  db: Db,
  model: string,
  capacityM3hr: number,
  headMwc: number,
  motorKw: number,
  asfRange: string | null = null,
  gbConstructionType: string | null = null,
  /** Charted head selected for this model in the Fluid step - fixes the RPM
   * window (see computePumpRpmWindow). */
  selectedHeadMwc: number | null = null,
): Promise<GearboxRecommendation | null> {
  const window = await computePumpRpmWindow(db, model, headMwc, capacityM3hr, selectedHeadMwc);
  if (!window) return null;
  const { rpmLo, rpmHi } = window;
  const rpmLoPadded = rpmLo * 0.8;
  const rpmHiPadded = rpmHi * 1.2;

  const asfBand = asfRange ? (ASF_BANDS[asfRange] ?? null) : null;

  const matches = (row: GearboxRow): boolean => {
    const rpm = toNum(row.outputRpm);
    if (rpm < rpmLoPadded || rpm > rpmHiPadded) return false;
    const kw = toNumOrNull(row.powerRatingKw);
    if (kw === null || Math.abs(kw - motorKw) > 0.01) return false;
    if (asfBand) {
      const sf = toNumOrNull(row.serviceFactor);
      if (sf === null || sf < asfBand[0] || sf > asfBand[1]) return false;
    }
    if (gbConstructionType && row.gearBoxType !== gbConstructionType) return false;
    return true;
  };

  const byOutputRpm = (a: GearboxOption, b: GearboxOption) => a.outputRpm - b.outputRpm;

  const [pblRows, ptlRows, topGearRows] = await Promise.all([
    db.select().from(schema.pblGearbox),
    db.select().from(schema.ptlGearbox),
    db.select().from(schema.topGearGearbox),
  ]);

  return {
    model,
    motorKw,
    rpmLo,
    rpmHi,
    rpmLoPadded,
    rpmHiPadded,
    pbl: pblRows.filter(matches).map(toGearboxOption).sort(byOutputRpm),
    ptl: ptlRows.filter(matches).map(toGearboxOption).sort(byOutputRpm),
    topGear: topGearRows.filter(matches).map(toGearboxOption).sort(byOutputRpm),
  };
}
