/**
 * Drizzle mapping of the live Postgres schema, ported from the old
 * azure-functions/shared/models.py. This app only queries the DB, it does not
 * run migrations against it — the column names/types here must match the
 * already-deployed schema exactly.
 *
 * Only the tables the sales portal needs are mapped (the testing-portal tables
 * — test_requisitions, pump_test_reports, pump_test_report_points, test_reports
 * — live with that portal's own migration when it is ported).
 *
 * Note: `pg` returns NUMERIC columns as strings. Read them through the `toNum`
 * helper in the engine rather than assuming they are already numbers.
 */
import {
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Raw binary column (Postgres bytea) — `pg`/Drizzle hand these back as a
// Node Buffer on read and accept one on write directly, no base64 needed at
// the DB layer (only over the JSON wire to/from the browser, which has no
// native binary type). Used for the MOC PDF report saved alongside its
// project (see moc_sealing_input.document below).
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// This project uses `users_pump`, a fork of the shared `users` table (seeded
// once from it). `users` stays owned by the testing portal — we never touch it.
// Export name kept as `users` so all call sites read/write users_pump unchanged.
export const users = pgTable("users_pump", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).default("user"),
  status: varchar("status", { length: 20 }).default("pending"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // Set when an admin issues/resets a password: the user is forced onto the
  // change-password screen and can't reach the rest of the app until they pick
  // their own. Cleared by POST /api/auth/change-password.
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  // Watermark for the top-bar bell's ADMIN feed: bug reports filed after this
  // instant are unread for this user. Opening the bell moves it to now().
  // A watermark rather than a per-report join table because the feed only
  // ever needs "what is new since I last looked", and it is per-user so one
  // admin clearing their bell never clears another's.
  bugFeedSeenAt: timestamp("bug_feed_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectCode: varchar("project_code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  customerName: varchar("customer_name", { length: 255 }),
  clientCode: varchar("client_code", { length: 100 }),
  industry: varchar("industry", { length: 255 }),
  remarks: text("remarks"),
  /** Date the enquiry was received (entered on the form). Null on enquiries
   *  created before the field existed. */
  enquiryDate: date("enquiry_date", { mode: "string" }),
  // Lifecycle, driven automatically (not just manually edited): "Pending" on
  // creation, flips to "In Progress" the first time General Information is
  // saved with real content, flips to "Completed" when the final report is
  // generated (see the wizard-input and project-report routes).
  status: varchar("status", { length: 50 }).default("Pending"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
  // The final, comprehensive Selection Summary PDF (Pump Selection + every
  // configured step, one box each) — generated and saved when the user
  // clicks "Confirm Pump Selection" on the last wizard step. One per
  // project (this table's own row, not a child table), which is what the
  // Reports page lists. Distinct from moc_sealing_input.document, which is
  // the narrower MOC-step-only report and isn't shown in that list.
  reportDocument: bytea("report_document"),
  reportFilename: varchar("report_filename", { length: 255 }),
  reportGeneratedAt: timestamp("report_generated_at", { withTimezone: true }),
  // Structured snapshot of the same report data (pumpFields + sections) —
  // lets the Reports list show a summary on click without re-parsing the
  // PDF or re-deriving live (possibly since-edited) wizard state.
  reportSummary: jsonb("report_summary"),
  // This enquiry's Technical Data Sheet customisation (lib/tech-doc.ts
  // TechDocConfig): optional rows added, rows removed, renamed labels, edited
  // cell values and manually added rows. Always read through
  // normalizeTechDocConfig.
  techDocConfig: jsonb("tech_doc_config").$type<Record<string, unknown>>().notNull().default({}),
  /** Commercial Offer sheet edits per drive group ({groups: {GM: OfferConfig}},
   *  lib/commercial-offer.ts): optional rows, removed / renamed rows, edited
   *  cells, manual rows, scope texts. Document only — prices are not changed. */
  /** One remarks note for the whole Commercial Summary (user, 2026-10-05 —
   *  replaces commercial_tag_price.remarks per tag). Frozen into quotation
   *  versions with the prices. */
  commercialRemarks: text("commercial_remarks"),
  commercialOfferConfig: jsonb("commercial_offer_config").$type<Record<string, unknown>>().notNull().default({}),
});


// One enquiry can carry multiple tags - a tag is a distinct pump-selection
// run under the same enquiry (media, duty point, drive, MOC all live per-tag).
// The 8 wizard-input tables below are keyed by tag_id, not by project_id, so
// a single project can hold N independent wizards. Legacy rows were backfilled
// onto a Default tag per project during the tag_id migration.
export const enquiryTags = pgTable("enquiry_tags", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  // Lifecycle for THIS tag (each pump-selection run has its own status):
  // "Pending" on creation, flips to "In Progress" the first time general_info
  // is saved with real content, flips to "Completed" when the final report is
  // generated for the tag. Same three-value set as the (now legacy) status
  // column on projects.
  status: varchar("status", { length: 50 }).notNull().default("Pending"),
  // Final Selection Summary PDF for THIS tag - generated when the user clicks
  // "Confirm Pump Selection" on the last wizard step. Moved off projects onto
  // enquiry_tags when tags gained their own wizards; the projects columns
  // stay for legacy rows the app no longer writes to.
  reportDocument: bytea("report_document"),
  reportFilename: varchar("report_filename", { length: 255 }),
  reportGeneratedAt: timestamp("report_generated_at", { withTimezone: true }),
  reportSummary: jsonb("report_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Autosaved wizard state — one table per wizard step, each with a unique
// projectId (one row per project), cascade-deleted with the project. Split
// out of a single pump_selection_input table (which only covered steps 1-4)
// so every step's inputs persist, not just the first four. Two intentional
// merges: MOC (step 4) + Sealing (step 5) share one table since they're
// reviewed together, and Motor Rating (step 6) + the Drive step's *common*
// fields (step 7) share one table; the Drive step's per-drive-type detail
// fields then split further into one table per drive system (only the
// table matching the chosen drive system ever gets a row). Column names
// mirror PumpSelectionFormData's field names/types exactly (raw strings the
// wizard's <input>/<select> elements produce) so rows can be spread directly
// into formData with no remapping.

// Step 1 — General Information. Temperature + pH are entered on the Fluid
// step (step 2) and live in fluid_properties_input, NOT here — General Info's
// persisted fields are exactly: capacity, capacity unit, head, head unit, SG,
// RPM range, media. Also carries the pump-selected fields
// (selectedModel/modelConfirmed) — the live-recommendation panel that sets
// these appears on every step 1-7 page, but General Info is where picking a
// model first becomes possible, so it's the natural home for "what did we
// land on" rather than a separate table.
export const generalInfoInput = pgTable("general_info_input", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Wizard rows are now keyed by tag, not by project: one project can carry
  // multiple tags, and each tag has its own independent wizard. project_id is
  // kept as a denormalised convenience + safety net for project-cascade
  // deletes, but the app writes/reads through tag_id.
  tagId: uuid("tag_id")
    .notNull()
    .unique()
    .references(() => enquiryTags.id, { onDelete: "cascade" }),
  capacity: varchar("capacity", { length: 50 }),
  capacityUnit: varchar("capacity_unit", { length: 20 }),
  head: varchar("head", { length: 50 }),
  headUnit: varchar("head_unit", { length: 20 }),
  media: varchar("media", { length: 255 }),
  sg: varchar("sg", { length: 50 }),
  rpmRange: varchar("rpm_range", { length: 20 }),
  selectedModel: varchar("selected_model", { length: 100 }),
  // The specific charted head (MWC) the user picked for the selected model.
  // Performance varies per head, so this - not a nearest-to-input guess -
  // drives the motor rating, RPM window and report calcs downstream.
  selectedHead: varchar("selected_head", { length: 20 }),
  modelConfirmed: boolean("model_confirmed").default(false),
  // Wizard progress: the step the user was last on (so a refresh reopens
  // exactly where they left off) and the furthest step they've ever reached
  // (so every step before it stays ticked/green even after jumping back).
  wizardStep: integer("wizard_step").default(1),
  wizardMaxStep: integer("wizard_max_step").default(1),
  // Head Calculator inputs saved with the tag ({suction, discharge}, as typed —
  // lib/head-calc-store.ts). Results are recalculated, never stored.
  headCalc: jsonb("head_calc"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Step 2 — Fluid Properties. Temperature (+ its raw/unit trio) and pH are
// entered on this step's form and persist here (they were moved out of
// general_info_input, where they used to be stored but never actually saved
// on leaving the Fluid step — a latent bug the move also fixes).
export const fluidPropertiesInput = pgTable("fluid_properties_input", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Wizard rows are now keyed by tag, not by project: one project can carry
  // multiple tags, and each tag has its own independent wizard. project_id is
  // kept as a denormalised convenience + safety net for project-cascade
  // deletes, but the app writes/reads through tag_id.
  tagId: uuid("tag_id")
    .notNull()
    .unique()
    .references(() => enquiryTags.id, { onDelete: "cascade" }),
  viscosity: varchar("viscosity", { length: 50 }),
  viscosityUnit: varchar("viscosity_unit", { length: 20 }),
  viscosityRange: varchar("viscosity_range", { length: 20 }),
  viscosityCp: varchar("viscosity_cp", { length: 50 }),
  solidPercentage: varchar("solid_percentage", { length: 50 }),
  solidSize: varchar("solid_size", { length: 50 }),
  // Solid size can be a single value or a Min-Max range, like pH / viscosity /
  // temperature. The base column above holds the single/MIN value - that is
  // the one pump screening uses.
  solidSizeMax: varchar("solid_size_max", { length: 50 }),
  solidSizeMode: varchar("solid_size_mode", { length: 10 }),
  solidType: varchar("solid_type", { length: 20 }),
  // end_connection / suction_connection / suction_flange_std /
  // discharge_flange_std moved to operating_conditions_input (2026-10-10);
  // the old columns stay in the DB until deploy, then get dropped.
  ph: varchar("ph", { length: 50 }),
  temperature: varchar("temperature", { length: 50 }), // canonical °C
  temperatureRaw: varchar("temperature_raw", { length: 50 }), // as-entered value
  temperatureUnit: varchar("temperature_unit", { length: 5 }), // C / F / K
  // pH / viscosity / temperature can each be a single value OR a Min–Max
  // range. `<field>Mode` = "single" | "range"; the base columns above hold the
  // single/min value and the `*Max` columns hold the range's upper bound. The
  // viscosity band (viscosityRange) is derived from the MAX (worst case) when
  // a range is entered. See src/lib/fluid-inputs.ts.
  phMax: varchar("ph_max", { length: 50 }),
  phMode: varchar("ph_mode", { length: 10 }),
  viscosityMax: varchar("viscosity_max", { length: 50 }),
  viscosityCpMax: varchar("viscosity_cp_max", { length: 50 }),
  viscosityMode: varchar("viscosity_mode", { length: 10 }),
  temperatureMax: varchar("temperature_max", { length: 50 }), // canonical °C (max)
  temperatureMaxRaw: varchar("temperature_max_raw", { length: 50 }), // as-entered (max)
  temperatureMode: varchar("temperature_mode", { length: 10 }),
  // Suction & discharge line sizes, always in inches. Both default to the
  // recommended size and both stay editable - a job can deviate from the
  // recommendation (and the two need not match each other).
  suctionSize: varchar("suction_size", { length: 20 }),
  dischargeSize: varchar("discharge_size", { length: 20 }),
  // The size the app recommended, kept so a deviation can be detected later
  // without re-running the recommendation. It is the CONFIRMED MODEL's own
  // size once a pump is picked (sizes are per-model), and the flat viscosity
  // band size before that. Deviating from it makes remarks mandatory.
  recommendedSize: varchar("recommended_size", { length: 20 }),
  // One remark for both sizes, mandatory once either deviates.
  sizeRemarks: text("size_remarks"),
  // LEGACY: the old separate remarks (backfilled into size_remarks). Kept
  // because main still reads them; not written by this branch. Drop both
  // after the merge.
  suctionSizeRemarks: text("suction_size_remarks"),
  dischargeSizeRemarks: text("discharge_size_remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Step 3 — Operating Conditions
export const operatingConditionsInput = pgTable("operating_conditions_input", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Wizard rows are now keyed by tag, not by project: one project can carry
  // multiple tags, and each tag has its own independent wizard. project_id is
  // kept as a denormalised convenience + safety net for project-cascade
  // deletes, but the app writes/reads through tag_id.
  tagId: uuid("tag_id")
    .notNull()
    .unique()
    .references(() => enquiryTags.id, { onDelete: "cascade" }),
  pumpType: varchar("pump_type", { length: 50 }),
  agBk: varchar("ag_bk", { length: 20 }),
  // AG/BK does not apply to every job. Choosing "Not Required" makes this
  // justification mandatory, so a deliberate omission is always on record.
  agBkRemarks: text("ag_bk_remarks"),
  bearingHousing: varchar("bearing_housing", { length: 50 }),
  suctionHousing: varchar("suction_housing", { length: 50 }),
  jointType: varchar("joint_type", { length: 50 }),
  // Vertical pumps hang into the sump, so the depth below the mounting flange
  // has to be stated. Only vertical pump types carry these; every other type
  // leaves them null.
  /** "Yes" / "No" - asked for every pump type; the size below applies when Yes. */
  negativeSuction: varchar("negative_suction", { length: 10 }),
  negativeSuctionSize: varchar("negative_suction_size", { length: 50 }),
  negativeSuctionUnit: varchar("negative_suction_unit", { length: 10 }),
  // Connections + flange standards (Specifications step; moved from
  // fluid_properties_input 2026-10-10). With AG & BK the suction connection
  // is "Bucket" and there is no suction flange std.
  /** Suction connection type: Flange / BSP Type / BSP with Flange (Bucket with AG / BK). */
  suctionConnection: varchar("suction_connection", { length: 120 }),
  /** Flange standards (flange_standard_master), one per side. */
  suctionFlangeStd: varchar("suction_flange_std", { length: 120 }),
  /** Discharge end connection type: End Cover / End Plate / BSP Type / BSP with Flange. */
  endConnection: varchar("end_connection", { length: 120 }),
  dischargeFlangeStd: varchar("discharge_flange_std", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Steps 4+5 — MOC & Elastomer + Sealing Details, merged. The AI panel is now
// persisted in full (per explicit user request that the post-generation UI
// survive a reload): the 8 per-component suggested materials, the provider +
// timestamp, AND the summary, alternatives, and sealing recommendation +
// rationale. On reload MocDetailsStep rebuilds the whole panel from these.
// Also stores the generated MOC PDF report itself as a binary blob
// (document), so a copy is saved alongside the project, not just downloaded
// to the browser.
export const mocSealingInput = pgTable("moc_sealing_input", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Wizard rows are now keyed by tag, not by project: one project can carry
  // multiple tags, and each tag has its own independent wizard. project_id is
  // kept as a denormalised convenience + safety net for project-cascade
  // deletes, but the app writes/reads through tag_id.
  tagId: uuid("tag_id")
    .notNull()
    .unique()
    .references(() => enquiryTags.id, { onDelete: "cascade" }),
  sealingType: varchar("sealing_type", { length: 30 }),
  sealingSubType: varchar("sealing_sub_type", { length: 10 }),
  // Gland Packing Type (GAGP / Teflon / PTFE / Carbon Fiber / Asbestos-Free) —
  // the Gland-Packing counterpart to sealingSubType (which is the Mechanical
  // Seal sub-type). Only one of the two is ever set, since the two sealing
  // types are mutually exclusive.
  glandPackingType: varchar("gland_packing_type", { length: 50 }),
  // Gland Packing make (Champion / Other) — only with Gland Packing.
  glandPackingMake: varchar("gland_packing_make", { length: 20 }),
  // Mechanical Seal detail (only with Mechanical Seal). sealingSubType above
  // holds the seal type (MSA/SCG/DCG/MSK); its description is derived, not stored.
  mechSealMoc: varchar("mech_seal_moc", { length: 40 }),
  mechSealFace: varchar("mech_seal_face", { length: 40 }),
  mechSealMake: varchar("mech_seal_make", { length: 40 }),
  // Why the engineer departed from the AI-recommended sealing arrangement.
  // Required in the UI only when the selection differs from that suggestion.
  sealingRemarks: text("sealing_remarks"),
  // Free-text extras the client supplied that the wizard has no field for
  // (chemical composition, special service notes, ...). Appended verbatim to
  // the MOC AI prompt as a "Client requirements" block.
  // Legacy free-text client requirements. Kept for backward compatibility with
  // rows saved before the field became a file upload; new rows leave this NULL
  // and use the file columns below instead.
  clientRequirements: text("client_requirements"),
  // Client-supplied requirements as an uploaded file (image or PDF). Bytes
  // never travel through the JSON /api/wizard-input path; the file has its
  // own binary endpoint under /wizard-input/moc-sealing/client-requirements.
  // Only the metadata (filename/mime/uploadedAt) is exposed through JSON so
  // the wizard can show "attached" state on reload without pulling the bytes.
  clientRequirementsFile: bytea("client_requirements_file"),
  clientRequirementsFilename: varchar("client_requirements_filename", { length: 255 }),
  clientRequirementsMime: varchar("client_requirements_mime", { length: 100 }),
  clientRequirementsUploadedAt: timestamp("client_requirements_uploaded_at", { withTimezone: true }),
  // Manual per-component MOC picks + open remarks (optionally eyeballed
  // against the AI suggestion below, entered independently — never
  // auto-filled from it, per the app's firm "advisory only" convention).
  mocAiBearingHousing: varchar("moc_ai_bearing_housing", { length: 50 }),
  mocAiBearingHousingRemarks: text("moc_ai_bearing_housing_remarks"),
  // Base Plate (Horizontal pump types) and Mounting Plate (Vertical) are
  // DIFFERENT components, not two names for one part - each keeps its own
  // column so a pump-type switch never reinterprets the other one's material.
  // Only the one matching the chosen pump type is shown/filled.
  mocAiBasePlate: varchar("moc_ai_base_plate", { length: 50 }),
  mocAiBasePlateRemarks: text("moc_ai_base_plate_remarks"),
  mocAiMountingPlate: varchar("moc_ai_mounting_plate", { length: 50 }),
  mocAiMountingPlateRemarks: text("moc_ai_mounting_plate_remarks"),
  mocAiTieRod: varchar("moc_ai_tie_rod", { length: 50 }),
  mocAiTieRodRemarks: text("moc_ai_tie_rod_remarks"),
  mocAiNutBolt: varchar("moc_ai_nut_bolt", { length: 50 }),
  mocAiNutBoltRemarks: text("moc_ai_nut_bolt_remarks"),
  mocAiPumpHousing: varchar("moc_ai_pump_housing", { length: 50 }),
  mocAiPumpHousingRemarks: text("moc_ai_pump_housing_remarks"),
  mocAiRotor: varchar("moc_ai_rotor", { length: 50 }),
  mocAiRotorRemarks: text("moc_ai_rotor_remarks"),
  mocAiShaft: varchar("moc_ai_shaft", { length: 50 }),
  mocAiShaftRemarks: text("moc_ai_shaft_remarks"),
  mocAiStatorRubber: varchar("moc_ai_stator_rubber", { length: 50 }),
  mocAiStatorRubberRemarks: text("moc_ai_stator_rubber_remarks"),
  // Stator Sleeve. Which group it belongs to depends on the pump type chosen
  // on Operating Conditions: non-wettable for the Horizontal variants, but
  // WETTABLE for Vertical (the sleeve sits in the pumped media there). Unlike
  // the base/mounting plate pair above, this IS one component that simply
  // changes group, so it keeps a single column.
  // See COMPONENT_GROUPS in MocDetailsStep.tsx.
  mocAiStatorSleeve: varchar("moc_ai_stator_sleeve", { length: 50 }),
  mocAiStatorSleeveRemarks: text("moc_ai_stator_sleeve_remarks"),
  // The AI's own per-component recommendation, as generated — "Suggested"
  // distinguishes these from the mocAi<Component> manual picks above.
  mocAiProvider: varchar("ai_provider", { length: 20 }), // "anthropic" (legacy rows may hold "gemini")
  mocAiSuggestedBearingHousing: text("ai_bearing_housing"),
  mocAiSuggestedBasePlate: text("ai_base_plate"),
  mocAiSuggestedMountingPlate: text("ai_mounting_plate"),
  mocAiSuggestedTieRod: text("ai_tie_rod"),
  mocAiSuggestedNutBolt: text("ai_nut_bolt"),
  mocAiSuggestedPumpHousing: text("ai_pump_housing"),
  mocAiSuggestedRotor: text("ai_rotor"),
  mocAiSuggestedShaft: text("ai_shaft"),
  mocAiSuggestedStatorRubber: text("ai_stator_rubber"),
  mocAiSuggestedStatorSleeve: text("ai_stator_sleeve"),
  // The rest of the AI panel — summary, alternatives, and the sealing
  // recommendation + its rationale. Persisted (previously session-only) so the
  // whole post-generation panel rebuilds on reload once AI has run for a
  // project (see MocDetailsStep's restore-from-formData path).
  mocAiSuggestedSummary: text("ai_summary"),
  mocAiSuggestedAlternatives: text("ai_alternatives"),
  mocAiSuggestedSealRecommendation: text("ai_seal_recommendation"),
  mocAiSuggestedSealMoc: text("ai_seal_moc"),
  mocAiSuggestedSealRationale: text("ai_seal_rationale"),
  mocAiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }),
  // The generated MOC PDF report, saved as raw bytes when downloaded.
  document: bytea("document"),
  documentFilename: varchar("document_filename", { length: 255 }),
  documentGeneratedAt: timestamp("document_generated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Step 6 (Motor Rating) + Step 7's drive-system-agnostic fields (Drive
// System Type itself, Motor RPM). The type-specific detail fields live in
// the three drive*Input tables below — only the one matching driveSystem
// ever gets a row.
//
// The whole "Drive System Inputs" motor block also lives here (make/mounting/
// efficiency/protection/frequency/voltage/starter/supply/std-non-std, the
// Non-Standard % uplifts, and the motor picked from motor_master). It used to
// sit in drive_vbelt_input, but those inputs apply to EVERY drive type — and
// that table is only written when driveSystem is "V-Belt Drive", so Direct/
// Geared selections silently never persisted. Moved here (drive-agnostic) to
// fix that; drive_vbelt_input now holds only genuinely belt-specific fields.
export const motorDriveInput = pgTable("motor_drive_input", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Wizard rows are now keyed by tag, not by project: one project can carry
  // multiple tags, and each tag has its own independent wizard. project_id is
  // kept as a denormalised convenience + safety net for project-cascade
  // deletes, but the app writes/reads through tag_id.
  tagId: uuid("tag_id")
    .notNull()
    .unique()
    .references(() => enquiryTags.id, { onDelete: "cascade" }),
  driveMotorKw: varchar("drive_motor_kw", { length: 50 }),
  // Mandatory once the chosen rating differs from the calculated
  // recommendation, in either direction - the quotation has to say why the
  // motor was sized off-recommendation.
  driveMotorKwRemarks: text("drive_motor_kw_remarks"),
  driveSystem: varchar("drive_system", { length: 50 }),
  // JS field name matches formData.motorRPM exactly (capital RPM) — not the
  // more conventional motorRpm — so autosave field lists don't need a
  // mapping layer.
  motorRPM: varchar("motor_rpm", { length: 10 }),
  // --- Drive System Inputs (all drive types) ---
  driveMotorSpeed: varchar("drive_motor_speed", { length: 20 }),
  driveMotorMake: varchar("drive_motor_make", { length: 50 }),
  driveMotorMounting: varchar("drive_motor_mounting", { length: 50 }),
  // Std / Non-Std gates which of the fields below are shown: Standard shows
  // efficiency/protection/frequency/voltage; Non-Standard additionally shows
  // the four *_pct uplift inputs.
  driveStdNonStd: varchar("drive_std_non_std", { length: 20 }),
  driveMotorEfficiency: varchar("drive_motor_efficiency", { length: 20 }),
  driveMotorProtection: varchar("drive_motor_protection", { length: 20 }),
  driveMotorFrequency: varchar("drive_motor_frequency", { length: 20 }),
  driveMotorVoltage: varchar("drive_motor_voltage", { length: 20 }),
  // Non-Standard only — percentage uplifts applied to the selected motor's
  // final price. Summed (additive), then applied once: uplifted =
  // finalPrice × (1 + (prot% + freq% + volt%)/100). Efficiency deliberately
  // has NO % uplift — it isn't a price adder, it selects which motor type
  // (IE class) the candidate list is filtered to.
  driveMotorProtectionPct: varchar("drive_motor_protection_pct", { length: 20 }),
  driveMotorFrequencyPct: varchar("drive_motor_frequency_pct", { length: 20 }),
  driveMotorVoltagePct: varchar("drive_motor_voltage_pct", { length: 20 }),
  // The motor picked from the motor_master candidate cards (filtered by KW +
  // RPM + mounting, narrowed by make). Denormalized copies, so a later edit to
  // motor_master doesn't silently change an already-quoted project.
  driveMotorFrameSize: varchar("drive_motor_frame_size", { length: 50 }),
  driveMotorLpPrice: varchar("drive_motor_lp_price", { length: 30 }),
  driveMotorFinalPrice: varchar("drive_motor_final_price", { length: 30 }),
  driveMotorPriceUplifted: varchar("drive_motor_price_uplifted", { length: 30 }),
  // Select-then-confirm, same as vbeltConfirmed above.
  driveMotorConfirmed: boolean("drive_motor_confirmed").default(false),
  driveStarterType: varchar("drive_starter_type", { length: 20 }),
  drivePowerSupply: varchar("drive_power_supply", { length: 20 }),
  // --- VFD (variable frequency drive) ---
  // "Yes" puts the motor on a VFD, so the pump runs anywhere between the min
  // and max Hz rather than at one fixed speed. The Recheck then reports
  // delivered capacity + BKW at both ends of that range:
  //   rpm at N Hz = final pump RPM x N / std Hz   (see lib/recheck-calc.ts)
  vfdRequired: varchar("vfd_required", { length: 10 }),
  vfdStdHz: varchar("vfd_std_hz", { length: 10 }),
  vfdMinHz: varchar("vfd_min_hz", { length: 10 }),
  vfdMaxHz: varchar("vfd_max_hz", { length: 10 }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Direct Drive specifics — no extra fields today beyond what's already in
// motor_drive_input, but kept as its own table (per spec: "different drive
// should have different table") so a future direct-drive-only field doesn't
// need another migration.
export const driveDirectInput = pgTable("drive_direct_input", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Wizard rows are now keyed by tag, not by project: one project can carry
  // multiple tags, and each tag has its own independent wizard. project_id is
  // kept as a denormalised convenience + safety net for project-cascade
  // deletes, but the app writes/reads through tag_id.
  tagId: uuid("tag_id")
    .notNull()
    .unique()
    .references(() => enquiryTags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// V-Belt Drive specifics — ONLY the selected belt option (groove/pulleys/rpm/
// center distance/belt number, written when a candidate card is clicked). The
// motor/rating-plate inputs that used to live here moved to motor_drive_input
// (see the comment there) because they apply to every drive type.
export const driveVbeltInput = pgTable("drive_vbelt_input", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Wizard rows are now keyed by tag, not by project: one project can carry
  // multiple tags, and each tag has its own independent wizard. project_id is
  // kept as a denormalised convenience + safety net for project-cascade
  // deletes, but the app writes/reads through tag_id.
  tagId: uuid("tag_id")
    .notNull()
    .unique()
    .references(() => enquiryTags.id, { onDelete: "cascade" }),
  driveVbeltGroove: varchar("drive_vbelt_groove", { length: 20 }),
  drivePumpPulley: varchar("drive_pump_pulley", { length: 20 }),
  driveMotorPulley: varchar("drive_motor_pulley", { length: 20 }),
  driveVbeltRpm: varchar("drive_vbelt_rpm", { length: 20 }),
  driveCenterDistance: varchar("drive_center_distance", { length: 20 }),
  driveVbeltNo: varchar("drive_vbelt_no", { length: 20 }),
  // Clicking a candidate card only *selects* it; the user then confirms (same
  // two-stage pattern as the pump model's modelConfirmed gate). Clicking the
  // selected card again clears both.
  vbeltConfirmed: boolean("vbelt_confirmed").default(false),
  /** No V-belt option was found, so drive_vbelt_rpm was typed in by hand
   *  (the selected pump RPM) — no pulley/belt details. */
  vbeltRpmManual: boolean("vbelt_rpm_manual").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Geared Motor Drive/Gear Box + Motor specifics — the selected gearbox
// option (source table/model/output RPM/service factor/rate, written when
// a candidate card is clicked) plus the Configuration/Mounting/Coupling/
// ASF Range/GB Type inputs.
export const driveGearedInput = pgTable("drive_geared_input", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Wizard rows are now keyed by tag, not by project: one project can carry
  // multiple tags, and each tag has its own independent wizard. project_id is
  // kept as a denormalised convenience + safety net for project-cascade
  // deletes, but the app writes/reads through tag_id.
  tagId: uuid("tag_id")
    .notNull()
    .unique()
    .references(() => enquiryTags.id, { onDelete: "cascade" }),
  gearBoxType: varchar("gear_box_type", { length: 20 }), // HISO / SISO
  gearedConfigType: varchar("geared_config_type", { length: 30 }),
  gbConstructionType: varchar("gb_construction_type", { length: 30 }), // IN LINE HELICAL / PLANTERY
  gearBoxMounting: varchar("gear_box_mounting", { length: 50 }),
  driveCoupling: varchar("drive_coupling", { length: 50 }),
  // Only relevant when driveCoupling is an actual coupling (not "No Coupling"):
  // the coupling construction type + its make. Shown on the Drive step only
  // when a coupling is present.
  couplingType: varchar("coupling_type", { length: 60 }),
  couplingMake: varchar("coupling_make", { length: 30 }),
  asfRange: varchar("asf_range", { length: 20 }),
  gearboxSource: varchar("gearbox_source", { length: 20 }), // PBL / PTL / Top Gear
  gearboxModel: varchar("gearbox_model", { length: 100 }),
  gearboxOutputRpm: varchar("gearbox_output_rpm", { length: 20 }),
  gearboxServiceFactor: varchar("gearbox_service_factor", { length: 20 }),
  gearboxRatePerNos: varchar("gearbox_rate_per_nos", { length: 20 }),
  // Select-then-confirm, same as vbeltConfirmed above.
  gearboxConfirmed: boolean("gearbox_confirmed").default(false),
  /** No gearbox option was found, so gearbox_output_rpm was typed in by hand
   *  (the selected pump RPM) — no gearbox model/source. */
  gearboxRpmManual: boolean("gearbox_rpm_manual").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Step 8 — Pump Model & Qty (after Drive). The ERP product code picked from
// product_pump, its pump type (PCP) and the number of pumps for the tag.
// Quantity lived on general_info_input until this step existed and was moved
// here. Not an approvable step (approvals cover steps 1-7).
export const pumpModelQtyInput = pgTable("pump_model_qty_input", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id")
    .notNull()
    .unique()
    .references(() => enquiryTags.id, { onDelete: "cascade" }),
  productCode: varchar("product_code", { length: 100 }),
  // "PCP" (from the picked product code). Named pump_family, not pump_type:
  // wizard state is one flat object and pumpType is already the
  // Specifications step's "Type of Pump" (operating_conditions_input).
  pumpFamily: varchar("pump_family", { length: 20 }),
  // Whole number, kept as the raw string like the other wizard fields.
  quantity: varchar("quantity", { length: 10 }),
  // The product code's parts when it was built with the code builder
  // (lib/pump-code.ts; option codes from pump_code_option). All null when the
  // code was picked from the existing list instead.
  codeSeries: varchar("code_series", { length: 30 }),
  codeSubCategory: varchar("code_sub_category", { length: 30 }),
  codeSize: varchar("code_size", { length: 30 }),
  codeStage: varchar("code_stage", { length: 30 }),
  codeModel: varchar("code_model", { length: 30 }),
  codeMoc: varchar("code_moc", { length: 30 }),
  codeRubber: varchar("code_rubber", { length: 30 }),
  codeSealing: varchar("code_sealing", { length: 30 }),
  codeSubSealing: varchar("code_sub_sealing", { length: 30 }),
  codeHousing: varchar("code_housing", { length: 30 }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Choices for each part of the pump product code (Pump & Qty code builder,
// lib/pump-code.ts): segment = series | sub_category | size | stage | model |
// moc | rubber | sealing | sub_sealing | housing; `code` is what goes into the
// product code, `label` what the dropdown shows (model "40L6" = H40L6, rubber
// "N" = Nitrile). Seeded 2026-10-03 from the user's sheet + the wizard lists
// (models from pump_model_master without the stage prefix); "+ Add" in the
// builder adds options to the addable segments.
export const pumpCodeOption = pgTable(
  "pump_code_option",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    segment: varchar("segment", { length: 20 }).notNull(),
    code: varchar("code", { length: 30 }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  },
  (t) => [unique("pump_code_option_segment_code_key").on(t.segment, t.code)],
);

// ERP pump product codes (e.g. RTOHV6OF8185AABN-MSA) — the list the Pump
// Model & Qty step picks from. Loaded from "Pump Model Master_2509026.xlsx"
// (PUMPS sheet), PCP rows only: 544 codes (one duplicate dropped; ROLB80BN
// left out - it is an Online Blind code wrongly typed PCP in the sheet).
export const productPump = pgTable("product_pump", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  productCode: varchar("product_code", { length: 100 }).notNull().unique(),
  pumpType: varchar("pump_type", { length: 20 }).notNull().default("PCP"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// One row per (model, head) data point — originally an exact mirror of
// `src/assets/pump_model_master.xlsx` (540 rows / 53 models). In that source
// file, qth/minKwExisting/minStartingKwAt1Kg/minKwTested/minKwToBeTested are
// merged cells spanning every head-row of a model (one value governs the
// whole model, not just its head=0 row) — the DB carries that value on every
// row of the model, not just the first, to preserve that meaning. Consumed by
// `findCandidates` in recommendation-engine.ts.
//
// Since seeding: `4H48/50` and `2H48/50` were each split into separate
// `*48`/`*50` models (identical performance data duplicated onto each) per
// user request — neither combined name exists anymore. And hardSolidMm/
// softSolidMm were added from `solid.xlsx` (max hard/soft solid particle size
// the model can pass, in mm) — that source only covers the straight H*/4H*
// model families, not 2H*/L-variant/Barrel models, and not every H*/4H* model
// either (e.g. H48 has no entry) — those rows are NULL.
//
// `stage` (1/2/4/8) is the pump's stage count, derived purely from the model
// name: a leading digit+H prefix (2H/4H/8H…) IS the stage number; a bare
// "H…" prefix (no leading digit) = 1. No 8-stage models exist in this table
// yet. The two Barrel* models have no "H" prefix at all but were classified
// stage 1 too — their own charted head range (0-60) matches the single-stage
// band and there's no 2Barrel/4Barrel counterpart.
// Option lists behind the Drive step's rating-plate dropdowns (Frequency,
// Voltage, Efficiency, Protection). A list is seeded with the usual values and
// grows when an engineer picks "Other" and types a new one, so the next
// enquiry can choose it from the list instead of retyping.
//
// Frequency and voltage hold the bare number — the unit never varies (Hz / V)
// and is added when the value is shown (src/lib/rating-plate.ts).
//
// One table with a `kind` column rather than four near-identical tables: the
// rows carry no per-kind attributes, and the Drive step reads all four lists
// in one request. UNIQUE (kind, lower(value)) keeps a list free of duplicates
// that differ only in case ("ip55" vs "IP55").
export const driveOptionMaster = pgTable("drive_option_master", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** frequency | voltage | efficiency | protection (DRIVE_OPTION_KINDS). */
  kind: varchar("kind", { length: 20 }).notNull(),
  value: varchar("value", { length: 50 }).notNull(),
  /** Seeded values sort first; anything added later falls in after them. */
  sortOrder: integer("sort_order").notNull().default(100),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

/** Flange standard options for the Fluid step (Suction and Discharge Flange Std
 *  share this list). "Other" on the form inserts here, so a value added once is
 *  offered to everyone afterwards. */
export const flangeStandardMaster = pgTable("flange_standard_master", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  value: varchar("value", { length: 120 }).notNull().unique(),
  /** Seeded standards sort first; anything added later falls in after them. */
  sortOrder: integer("sort_order").notNull().default(100),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

export const pumpModelMaster = pgTable(
  "pump_model_master",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    model: varchar("model", { length: 100 }).notNull(),
    headMwc: numeric("head_mwc", { precision: 10, scale: 2 }).notNull(),
    voleMin: numeric("vole_min", { precision: 10, scale: 2 }),
    voleMax: numeric("vole_max", { precision: 10, scale: 2 }),
    mechEff: numeric("mech_eff", { precision: 10, scale: 2 }),
    qth: numeric("qth", { precision: 10, scale: 4 }),
    minKwExisting: numeric("min_kw_existing", { precision: 10, scale: 2 }),
    minStartingKwAt1Kg: numeric("min_starting_kw_at_1kg", { precision: 10, scale: 2 }),
    minKwTested: numeric("min_kw_tested", { precision: 10, scale: 2 }),
    minKwToBeTested: numeric("min_kw_to_be_tested", { precision: 10, scale: 2 }),
    testingRemarks: text("testing_remarks"),
    hardSolidMm: numeric("hard_solid_mm", { precision: 6, scale: 2 }),
    softSolidMm: numeric("soft_solid_mm", { precision: 6, scale: 2 }),
    stage: integer("stage"),
    // Suction/discharge pipe size (inches) per viscosity band, sourced from
    // Model_vs_Viscosity_vs_Size.xlsx. The source is one row per model with 5
    // viscosity columns (0-1000, 1000-3000, 3000-5000, 5000-10000, >10000 cP);
    // stored here on every head-row of the model (same value across a model's
    // rows — same forward-fill pattern as qth/minKwTested). NULL means the
    // model isn't covered by that source sheet.
    sizeVisc0To1000In: numeric("size_visc_0_1000_in", { precision: 6, scale: 2 }),
    sizeVisc1000To3000In: numeric("size_visc_1000_3000_in", { precision: 6, scale: 2 }),
    sizeVisc3000To5000In: numeric("size_visc_3000_5000_in", { precision: 6, scale: 2 }),
    sizeVisc5000To10000In: numeric("size_visc_5000_10000_in", { precision: 6, scale: 2 }),
    sizeViscGt10000In: numeric("size_visc_gt_10000_in", { precision: 6, scale: 2 }),
  },
);

// Media / application reference list, used solely to populate the Media
// dropdown on the General Information step. Formerly "moc_recommendation"
// with curated MOC/pH/temp/seal columns from PCP_MOC_Selection_Sugar_NonSugar.pdf
// — those columns (and the recommendations derived from them) were dropped;
// this table is now pure reference data. New rows are added either by an
// admin or by a user typing a custom media via "Other" on the Media dropdown.
export const mediaList = pgTable(
  "media_list",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    industry: varchar("industry", { length: 20 }).notNull().default("Non-Sugar"),
    media: varchar("media", { length: 255 }).notNull().unique(),
  },
);

// (moc_nomenclature table dropped — decomposed MOC-code material breakdown
// that depended on the removed moc_recommendation.recommended_moc column.)

// V-belt/pulley drive selection, from "pulley v belt master.xlsx". Two tables
// mirroring the sheet's own nested structure — a parent "motor option" row
// (model × motor RPM × HP/KW tier, with grooves + shaft dimensions) and child
// "belt band" rows (up to 8 per parent, one per target pump-speed band —
// 180/220/260/300/340/380/420/480 RPM — giving the pulley pair, actual
// achieved RPM, center distance, and V-belt spec for that band). Not every
// parent has all 8 bands — larger-HP motors have fewer (5-6), which is
// genuine source data, not a gap.
//
// `model` is normalized to match pump_model_master (source writes "H-15",
// stored as "H15"). Coverage: only 26 of pump_model_master's 30 single-stage
// models — missing H70L3, H80L6, and both Barrel* models — and no 2H*/4H*
// coverage at all (V-belt drive appears to only be offered for single-stage
// pumps in this catalog). `grooves` (1A/1B/2A/2B/3B/3C/4D/5D) and `vBelt`
// (~50-150) are stored as opaque reference values — their exact engineering
// meaning (belt profile/groove count, pitch length, etc.) wasn't confirmed.
export const pulleyMotorOption = pgTable(
  "pulley_motor_option",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    model: varchar("model", { length: 100 }).notNull(),
    motorRpm: integer("motor_rpm").notNull(),
    motorHp: numeric("motor_hp", { precision: 6, scale: 2 }),
    motorKw: numeric("motor_kw", { precision: 6, scale: 2 }),
    maxCapAt60Mwc: numeric("max_cap_at_60mwc", { precision: 10, scale: 2 }),
    grooves: varchar("grooves", { length: 10 }),
    pumpShaftDia: numeric("pump_shaft_dia", { precision: 6, scale: 2 }),
    pumpShaftLength: numeric("pump_shaft_length", { precision: 6, scale: 2 }),
    motorShaftDia: numeric("motor_shaft_dia", { precision: 6, scale: 2 }),
    motorShaftLength: numeric("motor_shaft_length", { precision: 6, scale: 2 }),
  },
);

export const pulleyBeltOption = pgTable(
  "pulley_belt_option",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    pulleyMotorOptionId: uuid("pulley_motor_option_id")
      .notNull()
      .references(() => pulleyMotorOption.id, { onDelete: "cascade" }),
    targetRpm: integer("target_rpm").notNull(),
    pmpPulley: numeric("pmp_pulley", { precision: 6, scale: 2 }),
    mtrPulley: numeric("mtr_pulley", { precision: 6, scale: 2 }),
    actualRpm: numeric("actual_rpm", { precision: 8, scale: 2 }),
    centerDistance: numeric("center_distance", { precision: 8, scale: 2 }),
    vBelt: numeric("v_belt", { precision: 8, scale: 2 }),
  },
);

// Gearbox selection masters from "pblptlgearBox.xlsx" — three side-by-side
// tables in the source sheet (PBL / PTL / Top Gear), each row-grouped by a
// shared "Power Rating" (merged cell spanning that power tier's rows across
// all three blocks). Mirrored as three separate tables since each block has
// its own independent set of (output RPM, model) options for that power —
// a row in one block existing doesn't imply a matching row exists in another
// ("-" placeholders in the source mean "no option here," and are dropped
// rather than stored). powerRatingRaw preserves the source label verbatim
// (e.g. "0.55kw", "22.00KW" — inconsistent casing/spacing in the sheet
// itself); powerRatingKw is the parsed numeric value for filtering/joining.
// Column builders are stateful per Drizzle table, so each table needs its own
// fresh set of column definitions — a shared object literal passed to
// multiple pgTable() calls would attach the same builder instances to three
// different tables.
const gearboxColumns = () => ({
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  powerRatingRaw: varchar("power_rating_raw", { length: 20 }).notNull(),
  powerRatingKw: numeric("power_rating_kw", { precision: 8, scale: 3 }),
  outputRpm: numeric("output_rpm", { precision: 8, scale: 2 }).notNull(),
  model: varchar("model", { length: 50 }).notNull(),
  gearBoxType: varchar("gear_box_type", { length: 50 }),
  serviceFactor: numeric("service_factor", { precision: 6, scale: 2 }),
  ratePerNos: numeric("rate_per_nos", { precision: 12, scale: 2 }),
});

export const pblGearbox = pgTable("pbl_gearbox", gearboxColumns());
export const ptlGearbox = pgTable("ptl_gearbox", gearboxColumns());
export const topGearGearbox = pgTable("top_gear_gearbox", gearboxColumns());

// Standard motor rating (KW ↔ HP) reference, from "MOTOR RATING.xlsx" — 25
// rows, one KW value per row with its standard HP equivalent. kw is unique.
// "Report a Bug" reports filed from the top bar, for THIS app (kept in its
// OWN table, separate from the shared testing-portal `bug_reports` table so
// the two apps' bug data never mix — mirrors that table's shape plus the two
// bell-notification columns this app adds: reporter_unread + updated_at).
// Filed by any logged-in user; triaged by a system_admin on the Bug Tracker
// page; the reporter's bell lights up when their report's status changes.
export const bugReportSelection = pgTable("bug_report_selection", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: varchar("type", { length: 20 }).default("bug"), // bug | feature
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  severity: varchar("severity", { length: 20 }).default("Medium"), // Low|Medium|High|Critical
  page: varchar("page", { length: 255 }), // URL path where it was filed
  status: varchar("status", { length: 20 }).default("Open"), // Open|Need Clarification|In progress|Resolved (legacy Closed = Resolved column)
  screenshotFileName: varchar("screenshot_file_name", { length: 255 }),
  screenshotMimeType: varchar("screenshot_mime_type", { length: 100 }),
  screenshotFileSize: integer("screenshot_file_size"),
  screenshotData: bytea("screenshot_data"),
  reportedBy: uuid("reported_by"), // reporter (users.id); null on legacy
  reportedByName: varchar("reported_by_name", { length: 100 }),
  // Set true whenever the status changes; cleared once the reporter views
  // their notifications. Drives the top-bar bell badge for the reporter.
  reporterUnread: boolean("reporter_unread").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().$defaultFn(() => new Date()),
});

export const motorRating = pgTable("motor_rating", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  kw: numeric("kw", { precision: 8, scale: 3 }).notNull().unique(),
  hp: numeric("hp", { precision: 8, scale: 2 }).notNull(),
});

// Motor price-comparison master, sourced from the IE2 1500-RPM
// "Havells/CGL/ABB/Siemens Motor Price Compare Sheet". Normalized to LONG form
// (one row per motor rating × brand), per explicit user choice — the source
// sheet is wide (4 brands side by side per rating). Brand entries that offer
// nothing for a rating (source frame size "-"/"0" with zero prices) are NOT
// stored; any individual missing field is NULL rather than 0/"-". Excel float
// noise (e.g. 0.55000000000000004) was rounded on import. 116 rows as seeded
// (Siemens 23, ABB/CGL/Havells 31 each — Siemens lists fewer ratings). The
// source sheet's SR NO column is intentionally NOT stored (it's just a
// row index, not meaningful data).
export const motorMaster = pgTable("motor_master", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  motorKw: numeric("motor_kw", { precision: 10, scale: 3 }),
  motorHp: numeric("motor_hp", { precision: 10, scale: 3 }),
  motorRpm: integer("motor_rpm"),
  motorType: varchar("motor_type", { length: 20 }), // e.g. IE2
  mounting: varchar("mounting", { length: 20 }), // e.g. FOOT
  brand: varchar("brand", { length: 20 }), // Siemens / ABB / CGL / Havells
  frameSize: varchar("frame_size", { length: 50 }),
  lpPrice: numeric("lp_price", { precision: 14, scale: 2 }), // list price
  finalPrice: numeric("final_price", { precision: 14, scale: 2 }), // discounted/final
  // Date the brand's price list took effect (e.g. ABB FRSM-69 = 2026-05-22), so
  // a quote can say which price list it used. NULL for rows loaded before this
  // column existed. mode "string" keeps it as "YYYY-MM-DD" (no timezone shift).
  effectiveDate: date("effective_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

/*export const performanceCurve = pgTable("performance_curve", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  model: varchar("model", { length: 100 }).notNull(),
  pumpFamily: varchar("pump_family", { length: 20 }).default("PCP"),
  headMwc: numeric("head_mwc", { precision: 10, scale: 2 }),
  veMin: numeric("ve_min", { precision: 6, scale: 2 }),
  veMax: numeric("ve_max", { precision: 6, scale: 2 }),
  mechEfficiency: numeric("mech_efficiency", { precision: 6, scale: 2 }),
  isTested: boolean("is_tested").default(false),
});

export const veCorrection = pgTable("ve_correction", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  pumpFamily: varchar("pump_family", { length: 20 }).default("PCP"),
  viscosityMin: numeric("viscosity_min", { precision: 12, scale: 2 }),
  viscosityMax: numeric("viscosity_max", { precision: 12, scale: 2 }),
  veCorrection: numeric("ve_correction", { precision: 6, scale: 4 }),
});

export const motorMaster = pgTable("motor_master", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  kw: numeric("kw", { precision: 10, scale: 2 }),
  hp: numeric("hp", { precision: 10, scale: 2 }),
  rpm: integer("rpm"),
});

export const suctionVelocity = pgTable("suction_velocity", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  mediaType: varchar("media_type", { length: 50 }),
  recommendedVelocity: numeric("recommended_velocity", { precision: 6, scale: 2 }),
});

export const mechanicalSealChart = pgTable("mechanical_seal_chart", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  media: varchar("media", { length: 255 }),
  sealType: varchar("seal_type", { length: 255 }),
});

export const mocMaster = pgTable("moc_master", {
  mocCode: varchar("moc_code", { length: 20 }).primaryKey(),
  pumpHousing: varchar("pump_housing", { length: 100 }),
  shaft: varchar("shaft", { length: 100 }),
  rotor: varchar("rotor", { length: 100 }),
  cRod: varchar("c_rod", { length: 100 }),
  shd: varchar("shd", { length: 100 }),
  slv: varchar("slv", { length: 100 }),
  bush: varchar("bush", { length: 100 }),
  hPin: varchar("h_pin", { length: 100 }),
  pin: varchar("pin", { length: 100 }),
  protector: varchar("protector", { length: 100 }),
  holder: varchar("holder", { length: 100 }),
  statorRubber: varchar("stator_rubber", { length: 100 }),
});

export const mocSelectionGuide = pgTable("moc_selection_guide", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceType: varchar("service_type", { length: 100 }),
  casingMoc: varchar("casing_moc", { length: 255 }),
  rotorMoc: varchar("rotor_moc", { length: 255 }),
  statorMaterial: varchar("stator_material", { length: 255 }),
});

export const sealingSelectionRule = pgTable("sealing_selection_rule", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  condition: varchar("condition", { length: 255 }),
  recommendation: varchar("recommendation", { length: 20 }),
});

export const standardMotorKw = pgTable("standard_motor_kw", {
  kw: numeric("kw", { precision: 10, scale: 2 }).primaryKey(),
});

export const rpmBandMaster = pgTable("rpm_band_master", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  applicationClass: varchar("application_class", { length: 255 }),
  viscosityMin: numeric("viscosity_min", { precision: 12, scale: 2 }),
  viscosityMax: numeric("viscosity_max", { precision: 12, scale: 2 }),
  maxSolidPct: numeric("max_solid_pct", { precision: 5, scale: 2 }),
  rpmMin: integer("rpm_min"),
  rpmMax: integer("rpm_max"),
});

export const pumpSelections = pgTable("pump_selections", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id"),
  projectName: varchar("project_name", { length: 255 }),
  customerName: varchar("customer_name", { length: 255 }),
  capacity: varchar("capacity", { length: 50 }),
  capacityUnit: varchar("capacity_unit", { length: 20 }),
  head: varchar("head", { length: 50 }),
  headUnit: varchar("head_unit", { length: 20 }),
  media: varchar("media", { length: 255 }),
  temperature: varchar("temperature", { length: 50 }),
  sg: varchar("sg", { length: 50 }),
  ph: varchar("ph", { length: 50 }),
  viscosity: varchar("viscosity", { length: 50 }),
  viscosityUnit: varchar("viscosity_unit", { length: 20 }),
  viscosityRange: varchar("viscosity_range", { length: 50 }),
  solidPercentage: varchar("solid_percentage", { length: 50 }),
  solidSize: varchar("solid_size", { length: 50 }),
  pumpType: varchar("pump_type", { length: 100 }),
  bearingHousing: varchar("bearing_housing", { length: 100 }),
  suctionHousing: varchar("suction_housing", { length: 100 }),
  jointType: varchar("joint_type", { length: 100 }),
  driveSystem: varchar("drive_system", { length: 100 }),
  sealingType: varchar("sealing_type", { length: 100 }),
  motorMake: varchar("motor_make", { length: 100 }),
  gearboxMake: varchar("gearbox_make", { length: 100 }),
  motorRpm: varchar("motor_rpm", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

export const pumpRecommendations = pgTable("pump_recommendations", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  selectionId: uuid("selection_id"),
  model: varchar("model", { length: 100 }),
  rpm: varchar("rpm", { length: 50 }),
  flow: varchar("flow", { length: 50 }),
  head: varchar("head", { length: 50 }),
  bearingHousing: varchar("bearing_housing", { length: 100 }),
  suctionHousing: varchar("suction_housing", { length: 100 }),
  jointType: varchar("joint_type", { length: 100 }),
  sealingType: varchar("sealing_type", { length: 100 }),
  moc: varchar("moc", { length: 100 }),
  suctionSize: varchar("suction_size", { length: 50 }),
  deliverySize: varchar("delivery_size", { length: 50 }),
  motor: varchar("motor", { length: 100 }),
  driveSystem: varchar("drive_system", { length: 100 }),
  score: varchar("score", { length: 20 }),
  availability: varchar("availability", { length: 50 }),
  tested: varchar("tested", { length: 50 }),
  reportNo: varchar("report_no", { length: 100 }),
  rejectionReasons: text("rejection_reasons").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// media_types (growable media/application list) was dropped — the wizard's
// Media/Application dropdown now sources from moc_recommendation.media
// instead (see /api/moc-recommendation/media route), which is curated
// reference data rather than something the wizard grows.
*/

// --- Audit log ---------------------------------------------------------
// Full activity trail for the system-admin Audit Log page: who signed in,
// when, and every recorded action. Append-only — nothing in the app updates
// or deletes rows here. `eventType` separates sign-in events from ordinary
// actions so the page can count logins/sessions without scanning `action`
// strings:
//   login        - successful sign-in (one per session)
//   login_failed - rejected sign-in attempt (bad password / blocked status)
//   logout       - explicit sign-out
//   action       - anything else the user did (create/update/delete/generate)
// Identity is denormalised onto the row (email/role at the time) so the trail
// still reads correctly after a user is renamed, re-roled or removed.
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: uuid("user_id"),
  userEmail: varchar("user_email", { length: 255 }),
  userRole: varchar("user_role", { length: 30 }),
  eventType: varchar("event_type", { length: 20 }).notNull(),
  /** Dotted verb, e.g. "project.create", "wizard.save", "user.role_change". */
  action: varchar("action", { length: 80 }).notNull(),
  /** What was acted on (table/resource) and its id, when there is one. */
  entity: varchar("entity", { length: 80 }),
  entityId: varchar("entity_id", { length: 120 }),
  /** Short human-readable summary shown in the Activity feed. */
  detail: text("detail"),
  ip: varchar("ip", { length: 64 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Per-step approval, one row per (tag, wizard step). A step is put up for
// approval by ticking the toggle on that step's own header; the Approval step
// then lists everything ticked and sends them all at once.
//
// Unlike the wizard-input tables above this is NOT one row per tag — a tag
// carries up to seven rows, one per approvable step — so it has its own
// route (/api/step-approvals) rather than riding the wizard-input autosave.
export const stepApproval = pgTable(
  "step_approval",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => enquiryTags.id, { onDelete: "cascade" }),
    /** Wizard step number, 1-7 (see APPROVABLE_STEPS in lib/approval.ts). */
    step: integer("step").notNull(),
    /** Ticked on the step's own header — i.e. "this step needs approving". */
    selected: boolean("selected").notNull().default(false),
    /** "Pending" until sent, then "Awaiting Approval"; an approver later moves
     *  it to "Approved" / "Rejected". See APPROVAL_STATUSES in lib/approval.ts. */
    status: varchar("status", { length: 30 }).notNull().default("Pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentBy: uuid("sent_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by"),
    remarks: text("remarks"),
    createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
  },
  (t) => [unique("step_approval_tag_step_key").on(t.tagId, t.step)],
);

// Commercial Summary (pricing v1, manual) — one row per tag. Every price is
// typed in by the quotation team, per unit: Pump & Accessories plus the
// bought-out (BOI) items. Quantity is NOT stored here; it comes from the
// wizard's Pump Model & Qty step (pump_model_qty_input.quantity). Tag sub-total = (P&A + all BOI) ×
// quantity; the enquiry's grand total = sum of its tags' sub-totals — both
// computed (src/lib/commercial.ts), never stored.
export type CommercialOtherItem = {
  name: string;
  /** Base (vendor) price. */
  price: number | null;
  discountPct?: number | null;
  markupPct?: number | null;
};
/** Per fixed BOI row (motorPrice, gearboxPrice, …): vendor discount % and
 *  markup %. A missing row means 0 discount and the default 25 % markup. */
export type BoiAdjustMap = Record<string, { discountPct: number | null; markupPct: number | null }>;
export const commercialTagPrice = pgTable("commercial_tag_price", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id")
    .notNull()
    .unique()
    .references(() => enquiryTags.id, { onDelete: "cascade" }),
  paPrice: numeric("pa_price", { precision: 14, scale: 2 }),
  motorPrice: numeric("motor_price", { precision: 14, scale: 2 }),
  gearboxPrice: numeric("gearbox_price", { precision: 14, scale: 2 }),
  strainerPrice: numeric("strainer_price", { precision: 14, scale: 2 }),
  prvPrice: numeric("prv_price", { precision: 14, scale: 2 }),
  drpPrice: numeric("drp_price", { precision: 14, scale: 2 }),
  vfdPrice: numeric("vfd_price", { precision: 14, scale: 2 }),
  mechSealPrice: numeric("mech_seal_price", { precision: 14, scale: 2 }),
  /** The BOI Master mechanical seal used for mech_seal_price
   *  ("ACME SCG-1.5-7774 · SIC/SIC/VITON/304"), or null when typed by hand. */
  mechSealModel: varchar("mech_seal_model", { length: 200 }),
  /** The BOI Master VFD picked for vfd_price (its drive description), or null
   *  when the price was typed without picking one. */
  vfdModel: varchar("vfd_model", { length: 100 }),
  /** The DRP kit suggested from the BOI Master and used for drp_price
   *  (e.g. "RTD probe 50 mm + RTD panel"), or null when typed by hand. */
  drpModel: varchar("drp_model", { length: 200 }),
  /** What a used P&A price suggestion was based on (L1–L4 list, model row,
   *  MOC, adjustments), or null when the P&A price was typed by hand. */
  paBasis: varchar("pa_basis", { length: 300 }),
  /** Extra BOI lines, each named by the user. */
  others: jsonb("others").$type<CommercialOtherItem[]>().notNull().default([]),
  /** Vendor discount % + markup % per fixed BOI row; the *_price columns hold
   *  BASE prices. Quoted row price = base × (1 − disc) × (1 + markup). */
  boiAdjust: jsonb("boi_adjust").$type<BoiAdjustMap>().notNull().default({}),
  remarks: text("remarks"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Quotation (v1) — one per enquiry and drive group, independent of the sales portal (Market
// Intell is only READ, to prefill the client's TSM). Number:
// RIL/QT/<region_code>/<fin_year>/<product_type>/<serial>. region_code is the
// TSM's initials for now. `serial` comes from the Postgres sequence
// quotation_serial_seq (6000, 6001, … — user, 2026-10-01), one per enquiry:
// its drive-group quotations share it (unique on serial + drive_group).
// Two version tracks, independent of each other:
//   internal_version — V0 on create, +1 each time the TSM asks for changes
//                      (changing WHO the TSM is does not make a version);
//   client_version   — null until first sent, then V0, V1… per "Send to client".
export const quotation = pgTable(
  "quotation",
  {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** Drive group this quotation covers (lib/commercial DRIVE_GROUPS: GM, GB,
   *  VB, DD) — one quotation, with its own versions, per enquiry AND group.
   *  Added after the serial ("/GM") only when the enquiry mixes drives. */
  driveGroup: varchar("drive_group", { length: 4 }).notNull().default(""),
  productType: varchar("product_type", { length: 10 }).notNull().default("PCP"),
  quoteDate: date("quote_date", { mode: "string" }).notNull(),
  /** Indian financial year of quote_date, e.g. "2627" for Apr 2026 – Mar 2027. */
  finYear: varchar("fin_year", { length: 4 }).notNull(),
  serial: integer("serial"),
  /** Serial of the same quotation in ERP, typed in by hand (user, 2026-10-05);
   *  shown as "Quotation No. (ERP)" with the portal number's prefix. */
  erpSerial: varchar("erp_serial", { length: 30 }),
  regionCode: varchar("region_code", { length: 20 }),
  /** Market Intell users.id of the TSM (a reference only — no FK across DBs). */
  tsmRepId: integer("tsm_rep_id"),
  tsmName: varchar("tsm_name", { length: 255 }),
  tsmInitials: varchar("tsm_initials", { length: 20 }),
  tsmZone: varchar("tsm_zone", { length: 50 }),
  clientCode: varchar("client_code", { length: 100 }),
  clientName: varchar("client_name", { length: 255 }),
  internalVersion: integer("internal_version").notNull().default(0),
  clientVersion: integer("client_version"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
  },
  (t) => [unique("quotation_project_id_drive_group_key").on(t.projectId, t.driveGroup)],
);

// One row per version of either track, with a frozen copy of the prices at
// that moment (so what a client version showed never changes afterwards).
export const quotationVersion = pgTable(
  "quotation_version",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    quotationId: uuid("quotation_id")
      .notNull()
      .references(() => quotation.id, { onDelete: "cascade" }),
    track: varchar("track", { length: 10 }).notNull(), // internal | client
    version: integer("version").notNull(),
    reason: text("reason"),
    /** Internal versions: who asked for the changes — "TSM" (selection head later). */
    requestedBy: varchar("requested_by", { length: 30 }),
    /** Internal versions: what they asked to change. */
    note: text("note"),
    tsmName: varchar("tsm_name", { length: 255 }),
    tsmInitials: varchar("tsm_initials", { length: 20 }),
    snapshot: jsonb("snapshot").notNull(),
    /** null = the LIVE internal version: it follows the saved prices (the
     *  stored snapshot is refreshed when it freezes). It freezes when the next
     *  internal version starts or when it is sent to the client. Client
     *  versions are frozen from the start. At most one live row per quotation. */
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  },
  (t) => [unique("quotation_version_quotation_id_track_version_key").on(t.quotationId, t.track, t.version)],
);

// Client pump price reference files (Excel, kept on SharePoint under "Client
// Pump Price Ref/client pricing"). One row per file: its name, its SharePoint
// link and the sales (Market Intell) client it belongs to — blank when the file
// wasn't confidently matched to a client. Read-only reference for the
// Commercial Summary's "Client Price Ref" viewer; the files themselves are
// never touched, only linked to. file_date comes from the name's ddmmyyyy.
export const clientPriceRef = pgTable("client_price_ref", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  clientCode: varchar("client_code", { length: 100 }),
  clientName: varchar("client_name", { length: 255 }),
  fileName: varchar("file_name", { length: 300 }).notNull().unique(),
  url: text("url").notNull(),
  fileDate: date("file_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// BOI Master — bought-out items priced from a supplier list. One table per
// item type, each a tab on /admin/boi-master (VFD only for now).
//
// boi_vfd mirrors "VFD PRICE LIST 01-05-26 Dis 66.5 %" (docs/BOI): ABB ACS560,
// 3 Phase, U_N 400 V (380–480 V) — one row per drive with its frame, the three
// ratings (Nominal / Light Duty / Heavy Duty: kW + A) and the list price.
// The discount and the list date come from the file name. Net price =
// list_price × (1 − discount_pct / 100) + bop_extra (₹2,150 BOP with each
// ABB VFD, per the user). The Commercial Summary offers, for a
// tag with VFD Required = Yes, the smallest drive per duty covering the motor kW.
export const boiVfd = pgTable("boi_vfd", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  make: varchar("make", { length: 100 }).notNull(),
  series: varchar("series", { length: 100 }),
  supply: varchar("supply", { length: 100 }),
  driveDescription: varchar("drive_description", { length: 100 }).notNull().unique(),
  frame: varchar("frame", { length: 20 }),
  pnKw: numeric("pn_kw", { precision: 10, scale: 2 }),
  inA: numeric("in_a", { precision: 10, scale: 2 }),
  pldKw: numeric("pld_kw", { precision: 10, scale: 2 }),
  ildA: numeric("ild_a", { precision: 10, scale: 2 }),
  phdKw: numeric("phd_kw", { precision: 10, scale: 2 }),
  ihdA: numeric("ihd_a", { precision: 10, scale: 2 }),
  listPrice: numeric("list_price", { precision: 14, scale: 2 }),
  discountPct: numeric("discount_pct", { precision: 6, scale: 2 }),
  /** Flat BOP amount added to every VFD after the discount (₹2,150 for ABB). */
  bopExtra: numeric("bop_extra", { precision: 14, scale: 2 }),
  priceListDate: date("price_list_date", { mode: "string" }),
  /** Footnote markers etc. from the list (e.g. "I_HD 246*"). */
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// BOI Master, DRP tab — Dry Run Protection = RTD probe + RTD panel per pump.
// boi_drp_probe / boi_drp_panel mirror the two tables of "Drp Probe Price List
// 12-07-25.xlsx" (docs/BOI, W.E.F 12-07-2025). A tag's DRP = the smallest
// probe whose size >= its model's shaft dia (pump_shaft_dia) + the panel (one
// panel price "FOR ALL RTD").
export const boiDrpProbe = pgTable("boi_drp_probe", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  srNo: integer("sr_no"),
  description: varchar("description", { length: 200 }).notNull(),
  sizeMm: numeric("size_mm", { precision: 8, scale: 2 }).notNull().unique(),
  ratePerNos: numeric("rate_per_nos", { precision: 14, scale: 2 }),
  wefDate: date("wef_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

export const boiDrpPanel = pgTable("boi_drp_panel", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  srNo: integer("sr_no"),
  description: varchar("description", { length: 200 }).notNull(),
  appliesTo: varchar("applies_to", { length: 200 }),
  ratePerNos: numeric("rate_per_nos", { precision: 14, scale: 2 }),
  wefDate: date("wef_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Shaft dia per pump model — one row per model (every pump_model_master model
// plus H120L6), from the user's SHAFT DIA / MODEL image (families expanded:
// "H-48/50/52" -> H48, H50, H50L6, 2H48 …). Blank = not given yet (8H20,
// barrel models). BOI Master "Shaft Dia" tab; DRP picks its probe from it.
export const pumpShaftDia = pgTable("pump_shaft_dia", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  model: varchar("model", { length: 100 }).notNull().unique(),
  shaftDia: numeric("shaft_dia", { precision: 8, scale: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// P&A price lists L1–L4 ("l1-l4.xlsx", user 2026-10-03), mirrored as in the
// sheet. pa_price_level = the four lists' header rows (L-1 "NI- NON SUGAR
// INDUSTRIES - Price List_V5_" 19-02-2025; L-2 NI SUGAR V6, L-3 NON SUGAR V6,
// L-4 SUGAR V6, all 27-03-2026). pa_price_list = one row per pump model row
// (Sr. No., Pump Model No as written, e.g. "H-48/50/52", "H60L-3") with each
// list's MOC columns (L2 and L4 have no ACCN). pa_rubber_addon = "Viton AND
// HNBR — ADDED TO P&A" per family. The sheet's notes (bucket/auger %, EPDM,
// food grade, SS304 base plate, size ±3 %, CI casing, AABN = ABBN) are the
// rules in lib/pa-price.ts. Used by the Commercial Summary's P&A suggestion.
export const paPriceLevel = pgTable("pa_price_level", {
  level: varchar("level", { length: 4 }).primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  dateText: varchar("date_text", { length: 60 }),
  listDate: date("list_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

export const paPriceList = pgTable("pa_price_list", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  srNo: integer("sr_no"),
  pumpModelNo: varchar("pump_model_no", { length: 60 }).notNull().unique(),
  l1Abbn: numeric("l1_abbn", { precision: 14, scale: 2 }),
  l1Bbbn: numeric("l1_bbbn", { precision: 14, scale: 2 }),
  l1Accn: numeric("l1_accn", { precision: 14, scale: 2 }),
  l1Cccn: numeric("l1_cccn", { precision: 14, scale: 2 }),
  l2Abbn: numeric("l2_abbn", { precision: 14, scale: 2 }),
  l2Bbbn: numeric("l2_bbbn", { precision: 14, scale: 2 }),
  l2Cccn: numeric("l2_cccn", { precision: 14, scale: 2 }),
  l3Abbn: numeric("l3_abbn", { precision: 14, scale: 2 }),
  l3Bbbn: numeric("l3_bbbn", { precision: 14, scale: 2 }),
  l3Accn: numeric("l3_accn", { precision: 14, scale: 2 }),
  l3Cccn: numeric("l3_cccn", { precision: 14, scale: 2 }),
  l4Abbn: numeric("l4_abbn", { precision: 14, scale: 2 }),
  l4Bbbn: numeric("l4_bbbn", { precision: 14, scale: 2 }),
  l4Cccn: numeric("l4_cccn", { precision: 14, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

export const paRubberAddon = pgTable("pa_rubber_addon", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  pumpModel: varchar("pump_model", { length: 60 }).notNull().unique(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// BOI Master, Mechanical Seal tab — "ACME PRICE LIST NEW 25-03-26.pdf"
// (docs/BOI): DCG / SCG / K SERIES / N SERIES rows as in the list (MMP left
// out — user, 2026-10-04). Priced by shaft size (matched to the tag model's
// pump_shaft_dia); the list's PUMP MODEL NO column is not kept. Two material
// columns: SiC faces with SS304 / SS316 (DCG: SIC/SIC/C/SIC/VITON/…). Wizard
// seal type → series: SCG → SCG, DCG → DCG, MSA → N SERIES, MSK → K SERIES;
// SCG's "-AG" (AUGAR) row is used for auger pumps (sub-category AG / BAG).
export const boiMechSeal = pgTable("boi_mech_seal", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  make: varchar("make", { length: 60 }).notNull(),
  series: varchar("series", { length: 30 }).notNull(),
  drawingNo: varchar("drawing_no", { length: 60 }).notNull().unique(),
  shaftSizeInch: varchar("shaft_size_inch", { length: 20 }),
  shaftSizeMm: numeric("shaft_size_mm", { precision: 8, scale: 3 }).notNull(),
  type: varchar("type", { length: 20 }),
  material304: varchar("material_304", { length: 60 }),
  price304: numeric("price_304", { precision: 14, scale: 2 }),
  material316: varchar("material_316", { length: 60 }),
  price316: numeric("price_316", { precision: 14, scale: 2 }),
  priceListDate: date("price_list_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Technical Data Sheet client versions (user, 2026-10-05): "Send to client" on
// a drive group's sheet freezes it — rows, edits, values, header — as Client
// V0, V1, … per enquiry and group (NONE = tags without a drive). Independent
// of the quotation's versions. snapshot = the lib/tech-doc TechDocSheet.
export const techDocVersion = pgTable(
  "tech_doc_version",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    driveGroup: varchar("drive_group", { length: 4 }).notNull(),
    version: integer("version").notNull(),
    note: text("note"),
    snapshot: jsonb("snapshot").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  },
  (t) => [unique("tech_doc_version_project_id_drive_group_version_key").on(t.projectId, t.driveGroup, t.version)],
);
