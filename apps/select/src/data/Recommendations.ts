// Shared types for the pump selection / recommendation engine.
// Mirrors the Postgres master tables (see docs / backend masters sheet).

export interface PumpModelMaster {
  model: string;
  capacityMin: number;
  capacityMax: number;
  headMin: number;
  headMax: number;
  rpmMin: number;
  rpmMax: number;
  maxSolidPct: number;
}

export interface PerformanceCurvePoint {
  model: string;
  rpm: number;
  capacity: number; // m3/hr at this rpm
  head: number; // MWC at this rpm
  ve: number; // volumetric efficiency (0-1)
  efficiency: number; // mechanical efficiency (0-1)
}

export interface VECorrectionRow {
  viscosityMin: number;
  viscosityMax: number | null; // null = open ended
  veCorrection: number;
}

export interface MotorMasterRow {
  kw: number;
  hp: number;
  rpm: number;
}

export interface SuctionVelocityRow {
  mediaType: "Clean Liquid" | "Viscous Liquid" | "Slurry";
  recommendedVelocity: number; // m/s
}

export interface SealChartRow {
  media: string;
  sealType: string;
}

export interface MastersData {
  pumpModels: PumpModelMaster[];
  performanceCurve: PerformanceCurvePoint[];
  veCorrection: VECorrectionRow[];
  motors: MotorMasterRow[];
  suctionVelocity: SuctionVelocityRow[];
  mechanicalSeal: SealChartRow[];
}

// Raw wizard form input (values arrive as strings from <input>/<select>)
export interface PumpSelectionFormData {
  projectName: string;
  customerName: string;
  capacity: string;
  capacityUnit: string;
  head: string;
  headUnit: string;
  media: string;
  temperature: string; // canonical Celsius (derived from temperatureRaw + temperatureUnit)
  temperatureRaw?: string;
  temperatureUnit?: string; // "C" | "F" | "K"
  sg: string;
  // Pump Model & Qty step (pump_model_qty_input)
  productCode?: string; // ERP pump product code, from product_pump
  pumpFamily?: string; // "PCP" (pumpType is the Specifications step's Type of Pump)
  quantity?: string; // number of pumps for this tag (Commercial Summary)
  ph: string;
  viscosity: string;
  viscosityUnit: string;
  viscosityRange: string;
  viscosityCp?: string; // canonical cP value (cP = cSt × SG when entered in cSt)
  // pH / viscosity / temperature can each be a single value OR a Min–Max
  // range. `<field>Mode` is "single" (default when absent) or "range"; the
  // base fields above hold the single/min value, these hold the upper bound.
  // See src/lib/fluid-inputs.ts for the display formatting.
  phMax?: string;
  phMode?: string;
  viscosityMax?: string;
  viscosityCpMax?: string;
  viscosityMode?: string;
  temperatureMax?: string; // canonical Celsius (max)
  temperatureMaxRaw?: string; // as-entered (max)
  temperatureMode?: string;
  rpmRange?: string; // manual RPM band filter: low/medium/high/vhigh
  selectedModel?: string; // pump picked by the user; persists across steps
  selectedHead?: string; // charted head (MWC) picked for the model; drives downstream calcs
  modelConfirmed?: boolean; // true once the picked model is confirmed (gates advancing past Fluid)
  solidPercentage: string;
  solidSize: string; // single value, or the MIN of a range (drives screening)
  solidSizeMax?: string;
  solidSizeMode?: string;
  solidType?: string; // "Hard Solid" | "Soft Solid" — only relevant when solids > 0
  endConnection?: string; // discharge end connection: End Cover / End Plate / BSP Type / BSP with Flange
  suctionConnection?: string; // Flange / BSP Type / BSP with Flange
  suctionFlangeStd?: string; // flange standard (flange_standard_master)
  dischargeFlangeStd?: string;
  pumpType: string;
  suctionSize?: string; // inches — defaults to the recommended size
  dischargeSize?: string; // inches — defaults to the recommended size
  recommendedSize?: string; // baseline the two above are compared against
  sizeRemarks?: string; // suction / discharge size remarks — mandatory once either deviates
  agBk?: string; // AG / BK feed option — only set when viscosity > 10000 cP
  agBkRemarks?: string; // required justification when agBk is "Not Required"
  negativeSuctionSize?: string; // vertical pumps only - depth below the flange
  negativeSuctionUnit?: string; // "mt" | "mm"
  bearingHousing: string;
  suctionHousing: string;
  jointType: string;
  driveSystem: string;
  sealingType: string;
  sealingSubType?: string; // MSA / SCG / DCG / MSK — Mechanical Seal only
  glandPackingType?: string; // GAGP / Teflon / PTFE / Carbon Fiber / Asbestos-Free — Gland Packing only
  glandPackingMake?: string; // Champion / Other — Gland Packing only
  mechSealMoc?: string; // SS304 / SS316 / SS316L / Super Duplex Seal / 904L / Hastelloy — Mechanical Seal only
  mechSealFace?: string; // TC vs. TC / SiC vs. SiC — Mechanical Seal only
  mechSealMake?: string; // ACME / Eagle Burgmann / Sealmatic — Mechanical Seal only
  // Client-requirements file (image or PDF) uploaded on the MOC step. Bytes
  // live on the server; only the metadata is carried in formData so the
  // wizard can show/preserve "attached" state. `clientRequirements` (the
  // old free-text field) is kept for reading legacy drafts only.
  clientRequirements?: string;
  clientRequirementsFilename?: string;
  clientRequirementsMime?: string;
  clientRequirementsUploadedAt?: string;
  /** Wizard progress: last step visited, and the furthest step ever reached
   * (steps below it stay ticked in the stepper). Persisted on general_info. */
  wizardStep?: number;
  wizardMaxStep?: number;
  motorMake?: string;
  gearboxMake?: string;
  motorRPM?: string;
  gearBoxType?: string; // HISO / SISO — Geared Motor Drive only
  gearedConfigType?: string; // "Geared Motor" | "Gear Box + Motor" — cascades mounting + coupling below
  gbConstructionType?: string; // IN LINE HELICAL / PLANTERY — Geared Motor Drive only
  gearBoxMounting?: string; // Foot Mount B3 (Gear Box + Motor) / Flange Mount B5 / Foot cum Flange B35 (Geared Motor) — cascades on gearedConfigType
  driveCoupling?: string; // No Coupling / Driven Coupling / Drive + Driven Coupling (auto-filled from pump type + GB type)
  couplingType?: string; // Flexible Bush Pin / Spacer / Tyre Type — only when a coupling is present
  negativeSuction?: string; // "Yes" | "No" — whether the pump has a negative suction
  couplingMake?: string; // Rathi / Fenner — only when a coupling is present
  asfRange?: string; // Application Service Factor band — Geared Motor Drive only
  // Gearbox drive recommendation (manual pick from PBL/PTL/Top Gear masters,
  // screened by RPM window ±20% + Motor KW; narrowed by ASF Range + GB Type)
  gearboxSource?: string; // "PBL" | "PTL" | "Top Gear" — which master the pick came from
  gearboxModel?: string;
  gearboxOutputRpm?: string;
  gearboxServiceFactor?: string;
  gearboxRatePerNos?: string;
  /** Gearbox card picked, then explicitly confirmed. */
  gearboxConfirmed?: boolean;
  /** No gearbox option found — gearboxOutputRpm was typed in by hand. */
  gearboxRpmManual?: boolean;
  // Per-component MOC (manual selection, optionally seeded from the AI
  // recommendation panel) — non-wettable components
  mocAiBearingHousing?: string;
  mocAiBearingHousingRemarks?: string;
  // Base Plate (Horizontal) and Mounting Plate (Vertical) are different
  // components with their own fields - only the one matching the chosen pump
  // type is shown and filled.
  mocAiBasePlate?: string;
  mocAiBasePlateRemarks?: string;
  mocAiMountingPlate?: string;
  mocAiMountingPlateRemarks?: string;
  mocAiTieRod?: string;
  mocAiTieRodRemarks?: string;
  mocAiNutBolt?: string;
  mocAiNutBoltRemarks?: string;
  // Wettable casting components
  mocAiPumpHousing?: string;
  mocAiPumpHousingRemarks?: string;
  mocAiRotor?: string;
  mocAiRotorRemarks?: string;
  mocAiShaft?: string;
  mocAiShaftRemarks?: string;
  // Elastomer
  mocAiStatorRubber?: string;
  mocAiStatorRubberRemarks?: string;
  // Stator Sleeve - grouped as non-wettable for the Horizontal pump types
  // and as wettable for Vertical (see COMPONENT_GROUPS in MocDetailsStep).
  mocAiStatorSleeve?: string;
  mocAiStatorSleeveRemarks?: string;
  // The AI's own recommendation, persisted in full so the whole post-
  // generation panel rebuilds on reload — distinct from the manual
  // mocAi<Component> picks above, which are never auto-filled from these.
  mocAiProvider?: string; // "anthropic" (legacy rows may hold "gemini")
  mocAiSuggestedBearingHousing?: string;
  mocAiSuggestedBasePlate?: string;
  mocAiSuggestedMountingPlate?: string;
  mocAiSuggestedTieRod?: string;
  mocAiSuggestedNutBolt?: string;
  mocAiSuggestedPumpHousing?: string;
  mocAiSuggestedRotor?: string;
  mocAiSuggestedShaft?: string;
  mocAiSuggestedStatorRubber?: string;
  mocAiSuggestedStatorSleeve?: string;
  mocAiSuggestedSummary?: string;
  mocAiSuggestedAlternatives?: string;
  mocAiSuggestedSealRecommendation?: string;
  sealingRemarks?: string;
  mocAiSuggestedSealMoc?: string;
  mocAiSuggestedSealRationale?: string;
  mocAiGeneratedAt?: string;
  driveMotorKw?: string; // final drive motor rating (KW) chosen on the Motor Rating step
  driveMotorKwRemarks?: string; // mandatory once driveMotorKw deviates from the recommendation
  // V-Belt drive recommendation (Drive step, only when Drive System = V-Belt Drive)
  driveVbeltGroove?: string;
  drivePumpPulley?: string;
  driveMotorPulley?: string;
  driveVbeltRpm?: string; // recommended (or next-best) achieved pump RPM
  driveCenterDistance?: string;
  driveVbeltNo?: string;
  /** Belt card picked, then explicitly confirmed (select-then-confirm gate). */
  vbeltConfirmed?: boolean;
  /** No V-belt option found — driveVbeltRpm was typed in by hand. */
  vbeltRpmManual?: boolean;
  // Drive System inputs (shown for every drive system)
  driveMotorSpeed?: string; // motor nameplate speed (RPM) — manual, defaults from motorRPM
  driveMotorMake?: string; // BBL / Havells / CGL / ABB / Siemens / Other
  driveMotorMounting?: string; // Foot (B3) / Flange (B5) / Foot cum Flange (B35)
  driveStdNonStd?: string; // Standard / Non-Standard — gates the fields below
  /** Motor efficiency (IE) class — filters the motor_master candidates by
   * motor_type rather than adding to the price. */
  driveMotorEfficiency?: string; // "IE2" / "IE3"
  driveMotorProtection?: string; // free text, e.g. "IP55"
  driveMotorFrequency?: string; // free text, e.g. "50 Hz"
  driveMotorVoltage?: string; // free text, e.g. "415 V"
  // Non-Standard only — % price uplifts, summed then applied once to the
  // selected motor's final price. No efficiency % by design (see above).
  driveMotorProtectionPct?: string;
  driveMotorFrequencyPct?: string;
  driveMotorVoltagePct?: string;
  // Motor picked from the motor_master candidate cards
  driveMotorFrameSize?: string;
  driveMotorLpPrice?: string;
  driveMotorFinalPrice?: string;
  driveMotorPriceUplifted?: string; // finalPrice x (1 + total uplift %)
  /** Motor card picked, then explicitly confirmed. */
  driveMotorConfirmed?: boolean;
  driveStarterType?: string; // Star-Delta / DOL
  drivePowerSupply?: string; // Single Phase / Three Phase
  // VFD (variable frequency drive). "Yes" means the motor runs on a VFD, so
  // the pump speed varies with the supply frequency between min and max Hz;
  // the Recheck reports capacity + BKW at both ends (see lib/recheck-calc.ts).
  vfdRequired?: string; // Yes / No
  vfdStdHz?: string; // nameplate frequency the selected speed is quoted at
  vfdMinHz?: string;
  vfdMaxHz?: string;
}

// Output shape — matches what RecommendationTable / PumpDetailsCard render.
// Step-3 model screening only: capacity/head -> every pump_model_master model
// that satisfies the duty point. No MOC/sealing/suction-sizing/drive/motor
// fields yet (their master tables don't exist); no score/ranking either,
// since selection is manual (see recommendation-engine.ts findCandidates).
export interface PumpRecommendation {
  id: number;
  model: string;
  /** Nearest charted head point (in pump_model_master) to the input duty head. */
  headMwc: number;
  /** The stage's head band label, e.g. "0–60" / "60–120" — the MWC range
   * this pump's stage is selected for. */
  headBandMwc: string | null;
  /** NULL when the model has no charted VOLE/QTH at the matched head — the
   * model is still listed (stage-only inclusion), shown with blanks. */
  voleMin: number | null;
  voleMax: number | null;
  mechEff: number | null;
  qth: number | null;
  isTested: boolean;
  testingRemarks: string | null;
  rpmAtVoleMin: number | null;
  rpmAtVoleMax: number | null;
  rpmClassAtVoleMin: string | null;
  rpmClassAtVoleMax: string | null;
  /** "VOLE MAX rpm–VOLE MIN rpm", e.g. "249–302". "—" when no computable RPM. */
  rpmRange: string;
  /** True if this is the model the user pinned on an earlier step. */
  isSelected?: boolean;
  /** Max hard-solid particle size this model can pass (mm), or null if unrecorded. */
  hardSolidMm: number | null;
  /** Max soft-solid particle size this model can pass (mm), or null if unrecorded. */
  softSolidMm: number | null;
  /** Pump stage count (1/2/4/8) derived from the model name. */
  stage: number | null;
  /** Suction/discharge pipe sizes (inches) per viscosity band, sourced from
   * pump_model_master. NULL when this model isn't covered by the source sheet
   * (the model then has no recommended size). */
  sizeVisc0To1000In: number | null;
  sizeVisc1000To3000In: number | null;
  sizeVisc3000To5000In: number | null;
  sizeVisc5000To10000In: number | null;
  sizeViscGt10000In: number | null;
  /** The model's full charted performance curve — one entry per head row,
   * ascending by head. Lets the recommendation show every head point (VOLE /
   * Mech-Eff / RPM all vary per head) rather than only the duty-nearest row. */
  headPoints?: HeadPoint[];
}

/** One charted head point of a model's performance curve. */
export interface HeadPoint {
  headMwc: number;
  voleMin: number | null;
  voleMax: number | null;
  mechEff: number | null;
  qth: number | null;
  /** "VOLE-max rpm–VOLE-min rpm" at this head, or "—" when not computable. */
  rpmRange: string;
  /** The same window as numbers (best-case low / high speed), or null. */
  rpmLo?: number | null;
  rpmHi?: number | null;
}
