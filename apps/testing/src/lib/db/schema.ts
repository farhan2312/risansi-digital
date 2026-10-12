/**
 * Drizzle mapping of the shared Postgres schema for the testing portal.
 *
 * `users` mirrors sales-portal-next/src/lib/db/schema.ts exactly (read-only
 * here — that app owns migrations for it) since both apps share one `users`
 * table and JWT_SECRET, so a login in either app works in both.
 *
 * test_requisitions / pump_test_reports / pump_test_report_points are this
 * app's own tables — this app owns their migrations (drizzle-kit, see
 * package.json db:generate / db:migrate).
 */
import {
  boolean,
  customType,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// drizzle-orm/pg-core has no built-in bytea helper -- Buffer in/out via a
// minimal customType, per Drizzle's own recommended pattern for raw bytea.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).default("user"),
  status: varchar("status", { length: 20 }).default("pending"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  // Forces a password change on first login. Defaults true for new accounts;
  // cleared once the user successfully changes their password.
  mustChangePassword: boolean("must_change_password").notNull().default(true),
});

export const testRequisitions = pgTable("test_requisitions", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Human-readable sequential number ("REQ-000123"), assigned via the DB
  // sequence test_requisitions_requisition_no_seq at insert time (see
  // requisitions/route.ts POST) -- the identifier shown in the URL and UI
  // instead of the raw uuid id above, same pattern as pump_test_reports
  // .report_no. id itself never disappears -- every FK-style reference
  // (pump_test_reports.requisition_id, action_registry.requisition_id,
  // audit_logs.entity_id) keeps storing the real uuid; only the
  // human-facing routes resolve either form down to it (see
  // lib/requisitionLookup.ts).
  requisitionNo: varchar("requisition_no", { length: 20 }),

  model: varchar("model", { length: 100 }).notNull(),
  category: varchar("category", { length: 100 }),
  ecQuotationNo: varchar("ec_quotation_no", { length: 100 }),
  offerDate: date("offer_date"),
  responsiblePerson: varchar("responsible_person", { length: 100 }),
  sourceTeam: varchar("source_team", { length: 50 }),
  dateOfRequisition: date("date_of_requisition"),
  testQty: integer("test_qty"),

  qth: numeric("qth", { precision: 10, scale: 4 }),
  specificGravity: numeric("specific_gravity", { precision: 6, scale: 3 }),
  powerHp: numeric("power_hp", { precision: 10, scale: 2 }),
  powerKw: numeric("power_kw", { precision: 10, scale: 4 }),
  headKgcm2: numeric("head_kgcm2", { precision: 10, scale: 2 }),
  headUnit: varchar("head_unit", { length: 20 }),
  rpm: numeric("rpm", { precision: 10, scale: 2 }),
  motorRpm: numeric("motor_rpm", { precision: 10, scale: 2 }),
  reqCapacity: numeric("req_capacity", { precision: 10, scale: 4 }),
  reqCapacityUnit: varchar("req_capacity_unit", { length: 20 }),

  // Only shown/filled on the requisition form when Category is "Against
  // R&D Trials" -- general_remarks (below) doubles as "Open Remarks" there.
  mediaType: varchar("media_type", { length: 100 }),
  targetDate: date("target_date"),

  observation: text("observation"),
  raValue: numeric("ra_value", { precision: 10, scale: 4 }),
  veRatedHead: numeric("ve_rated_head", { precision: 6, scale: 2 }),
  meRatedHead: numeric("me_rated_head", { precision: 6, scale: 2 }),
  measuredCapacity: numeric("measured_capacity", { precision: 10, scale: 4 }),
  measuredHead: numeric("measured_head", { precision: 10, scale: 2 }),
  measuredPower: numeric("measured_power", { precision: 10, scale: 4 }),
  noiseJammingOther: text("noise_jamming_other"),
  action: text("action"),
  npsha: numeric("npsha", { precision: 10, scale: 4 }),
  testResult: varchar("test_result", { length: 20 }),

  testingPlanDate: date("testing_plan_date"),
  dateOfTesting: date("date_of_testing"),
  retestWithoutChangingDiePin: boolean("retest_without_changing_die_pin"),
  retestNeeded: boolean("retest_needed"),
  diePinRework: boolean("die_pin_rework"),
  status: varchar("status", { length: 30 }).default("Pending"),
  generalRemarks: text("general_remarks"),
  actionRemarks: text("action_remarks"),

  createdBy: uuid("created_by"),
  // Display name for who raised this requisition, resolved server-side from
  // the logged-in account at creation time — same pattern as pump_test_reports
  // .prepared_by. created_by (above) stays a uuid, used only for the
  // source-role visibility filter, not for display.
  submittedBy: varchar("submitted_by", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const pumpTestReports = pgTable("pump_test_reports", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  requisitionId: uuid("requisition_id"),

  // Human-readable sequential number, assigned via the DB sequence
  // pump_test_reports_report_no_seq at insert time (see reports/route.ts POST).
  reportNo: varchar("report_no", { length: 20 }),

  model: varchar("model", { length: 100 }).notNull(),
  gearboxNo: varchar("gearbox_no", { length: 255 }),
  gearboxRatio: varchar("gearbox_ratio", { length: 50 }),
  motor: varchar("motor", { length: 100 }),
  motorRpm: numeric("motor_rpm", { precision: 10, scale: 2 }),
  suctionType: varchar("suction_type", { length: 20 }),

  liquid: varchar("liquid", { length: 100 }).default("WATER"),
  ratedCapacity: numeric("rated_capacity", { precision: 10, scale: 4 }),
  ratedHead: numeric("rated_head", { precision: 10, scale: 2 }),
  specificGravity: numeric("specific_gravity", { precision: 6, scale: 3 }),
  viscosityCps: numeric("viscosity_cps", { precision: 10, scale: 2 }),
  kForGivenCps: numeric("k_for_given_cps", { precision: 10, scale: 4 }),
  ratedRpm: numeric("rated_rpm", { precision: 10, scale: 2 }),
  qTheoretical100rev: numeric("q_theoretical_100rev", { precision: 10, scale: 4 }),
  calculatedHead: numeric("calculated_head", { precision: 10, scale: 2 }),
  // Requirement-check target for Power, alongside ratedCapacity/ratedHead/
  // ratedRpm above -- autofilled from the requisition's Power (HP/KW) so a
  // report can tell on its own whether testing actually reached it.
  ratedPowerKw: numeric("rated_power_kw", { precision: 10, scale: 4 }),

  // New fields for the digital "OBSERVATION SHEET" format (NEW PUMP TESTING
  // FORMATE FOR DIGITAL): capacity measurement method, NPSHa reading, units,
  // and the reference/baseline readings (Vin/Iin/Hin) used by its formulas.
  testType: varchar("test_type", { length: 20 }), // 'Flow Meter' | 'Barrel' | 'V-notch'
  npshaStatus: varchar("npsha_status", { length: 20 }), // 'POSITIVE' | 'NEGATIVE'
  capacityUnit: varchar("capacity_unit", { length: 20 }),
  headUnit: varchar("head_unit", { length: 20 }),
  referenceVoltage: numeric("reference_voltage", { precision: 10, scale: 2 }), // Vin
  referenceCurrent: numeric("reference_current", { precision: 10, scale: 2 }), // Iin
  vnotchBaseline: numeric("vnotch_baseline", { precision: 10, scale: 2 }), // Hin

  testedBy: varchar("tested_by", { length: 100 }),
  testDate: date("test_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),

  // Which physical form this report was filled against — 'observation' (v-notch
  // sheet) or 'viscosity-chart' (UPDATE SHEET V-NOTCH (2)) — since they have
  // different header fields and calculations.
  reportFormat: varchar("report_format", { length: 30 }),

  // Header fields specific to the Viscosity Correction Chart format.
  poNo: varchar("po_no", { length: 100 }),
  ecNo: varchar("ec_no", { length: 100 }),
  revNo: varchar("rev_no", { length: 20 }),
  revDate: date("rev_date"),
  pumpSerialNo: varchar("pump_serial_no", { length: 100 }),

  // Vibration test + run summary footer block, Observation Sheet only.
  vibrationSoundDb: numeric("vibration_sound_db", { precision: 6, scale: 2 }),
  vibrationXMmSec: numeric("vibration_x_mm_sec", { precision: 6, scale: 2 }),
  vibrationYMmSec: numeric("vibration_y_mm_sec", { precision: 6, scale: 2 }),
  vibrationZMmSec: numeric("vibration_z_mm_sec", { precision: 6, scale: 2 }),
  pumpStartedAt: varchar("pump_started_at", { length: 20 }),
  pumpStoppedAt: varchar("pump_stopped_at", { length: 20 }),
  totalRun: varchar("total_run", { length: 20 }),
  ambientTempC: numeric("ambient_temp_c", { precision: 6, scale: 2 }),
  maxBearingTempC: numeric("max_bearing_temp_c", { precision: 6, scale: 2 }),
  totalRiseC: numeric("total_rise_c", { precision: 6, scale: 2 }),
  witness: varchar("witness", { length: 100 }),
  inspector: varchar("inspector", { length: 100 }),
  recorder: varchar("recorder", { length: 100 }),

  remarks: text("remarks"),

  // Who submitted this report through the portal — captured server-side from
  // the logged-in account at creation, distinct from "tested_by" (a free-text
  // name for whoever physically ran the test, which may not have a login).
  // Never touched by edits — reflects the original submitter, always.
  preparedBy: varchar("prepared_by", { length: 100 }),
});

export const pumpTestReportPoints = pgTable("pump_test_report_points", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  reportId: uuid("report_id").notNull(),

  rpm: numeric("rpm", { precision: 10, scale: 2 }),
  headKgcm2: numeric("head_kgcm2", { precision: 10, scale: 2 }),
  headMwc: numeric("head_mwc", { precision: 10, scale: 2 }),
  vnotchHeight: numeric("vnotch_height", { precision: 10, scale: 4 }),
  initialReading: numeric("initial_reading", { precision: 10, scale: 4 }),
  differentialHeight: numeric("differential_height", { precision: 10, scale: 4 }),
  capacityCalculatedM3hr: numeric("capacity_calculated_m3hr", { precision: 10, scale: 4 }),
  volts: numeric("volts", { precision: 10, scale: 2 }),
  amps: numeric("amps", { precision: 10, scale: 2 }),
  cosPhi: numeric("cos_phi", { precision: 6, scale: 3 }),
  powerCalculatedKw: numeric("power_calculated_kw", { precision: 10, scale: 6 }),
  theoreticalPowerKw: numeric("theoretical_power_kw", { precision: 10, scale: 6 }),
  mechanicalEfficiency: numeric("mechanical_efficiency", { precision: 10, scale: 6 }),
  theoreticalCapacityAtMeasuredRpm: numeric("theoretical_capacity_at_measured_rpm", { precision: 10, scale: 4 }),
  slipWater: numeric("slip_water", { precision: 10, scale: 4 }),
  slipViscous: numeric("slip_viscous", { precision: 10, scale: 4 }),
  theoreticalCapacityAtRatedRpm: numeric("theoretical_capacity_at_rated_rpm", { precision: 10, scale: 4 }),
  capacityLiquidAtRatedRpmM3hr: numeric("capacity_liquid_at_rated_rpm_m3hr", { precision: 10, scale: 4 }),
  capacityLiquidAtRatedRpmLph: numeric("capacity_liquid_at_rated_rpm_lph", { precision: 10, scale: 2 }),

  // New fields for the digital format's raw inputs + volumetric efficiency.
  heightTakenForFilling: numeric("height_taken_for_filling", { precision: 10, scale: 2 }), // mm, V-notch/tank method
  timeTakenToFillBucketSec: numeric("time_taken_to_fill_bucket_sec", { precision: 10, scale: 2 }), // Barrel method
  volumetricEfficiency: numeric("volumetric_efficiency", { precision: 10, scale: 6 }), // VE % (water)

  // Viscosity Correction Chart format: liquid-corrected efficiencies (use
  // capacity-for-liquid-at-rated-rpm rather than raw measured capacity).
  volumetricEfficiencyLiquid: numeric("volumetric_efficiency_liquid", { precision: 10, scale: 6 }),
  mechanicalEfficiencyLiquid: numeric("mechanical_efficiency_liquid", { precision: 10, scale: 6 }),
});

// Quick-pick model suggestions for the requisition Model dropdown. Seeded
// with the common models list (see scripts/add-pump-models-table.mjs); grows
// automatically -- a requisition's model gets added here once its testing
// closes, if it wasn't already a known value (see reports/route.ts POST).
export const pumpModels = pgTable("pump_models", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  model: varchar("model", { length: 100 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Files the source team (or central-admin/admin) attaches to a requisition
// at intake -- PO copies, drawings, spec sheets -- so the testing team can
// open them without a side-channel email. Stored inline (bytea) rather than
// in object storage: this app has no file-storage service set up, and
// Vercel Serverless Functions cap a request body at ~4.5MB regardless, so
// uploads are capped at 4MB app-side (see attachments/route.ts) and the
// volume here stays modest enough for Postgres to carry comfortably.
export const requisitionAttachments = pgTable("requisition_attachments", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  requisitionId: uuid("requisition_id").notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: bytea("file_data").notNull(),
  uploadedBy: uuid("uploaded_by"),
  // Name snapshot, same convention as test_requisitions.submitted_by -- stays
  // human-readable even if the uploader's account is later removed.
  uploadedByName: varchar("uploaded_by_name", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// "Report a Bug" widget, available to every logged-in user regardless of
// role -- screenshot stored the same bytea-in-Postgres way as attachments
// above, capped at 4MB app-side (see bug-reports/route.ts).
export const bugReports = pgTable("bug_reports", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: varchar("type", { length: 20 }).default("bug"), // 'bug' | 'feature'
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  severity: varchar("severity", { length: 20 }).default("Medium"), // 'Low' | 'Medium' | 'High' | 'Critical'
  page: varchar("page", { length: 255 }),
  status: varchar("status", { length: 20 }).default("Open"), // 'Open' | 'In Progress' | 'Resolved'
  screenshotFileName: varchar("screenshot_file_name", { length: 255 }),
  screenshotMimeType: varchar("screenshot_mime_type", { length: 100 }),
  screenshotFileSize: integer("screenshot_file_size"),
  screenshotData: bytea("screenshot_data"),
  reportedBy: uuid("reported_by"),
  // Name snapshot, same convention as requisitionAttachments.uploadedByName.
  reportedByName: varchar("reported_by_name", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  // Backs the sidebar notification bell -- false until an admin opens this
  // report's detail (GET /api/bug-reports/[id]), at which point it flips
  // true and drops out of the unread count. Not per-admin (one shared flag,
  // not a per-user read receipt) -- deliberately simple for this app's
  // small admin headcount.
  isRead: boolean("is_read").notNull().default(false),
});

// "Your bug report's status changed" notifications, shown in the reporter's top-bar bell (see
// bug-reports/[id] PATCH and /api/bug-notifications). userId is the recipient (the report's reporter).
// bugTitle / changedByName are snapshots, and there are no foreign keys, so removing a bug report or an
// account never has to clean these up first.
export const bugReportNotifications = pgTable("bug_report_notifications", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: uuid("user_id").notNull(),
  bugReportId: uuid("bug_report_id"),
  bugTitle: varchar("bug_title", { length: 255 }).notNull(),
  oldStatus: varchar("old_status", { length: 20 }),
  newStatus: varchar("new_status", { length: 20 }).notNull(),
  changedByName: varchar("changed_by_name", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  // null = not seen yet (counts toward the bell's badge).
  readAt: timestamp("read_at", { withTimezone: true }),
});

// Audit Log: append-only trail of logins and every data-changing action,
// admin-only (see audit.ts and the audit-log API routes). user_id/name/email
// are ALWAYS a name snapshot (same convention as submitted_by elsewhere) --
// the log has to stay readable even after the account is later deleted, and
// a failed login has no valid user_id to begin with.
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: uuid("user_id"),
  userName: varchar("user_name", { length: 100 }),
  userEmail: varchar("user_email", { length: 255 }),
  // 'login' | 'login_failed' | 'logout' | 'create' | 'update' | 'delete'
  eventType: varchar("event_type", { length: 30 }).notNull(),
  // 'requisition' | 'report' | 'attachment' | 'user' | 'bug_report' | null (login/logout events)
  entityType: varchar("entity_type", { length: 30 }),
  entityId: uuid("entity_id"),
  // Human-readable label for the row list -- e.g. a requisition's model, a
  // report's report_no -- so the log reads without joining back to the row
  // (which may itself be gone by the time anyone looks).
  entityLabel: varchar("entity_label", { length: 255 }),
  details: text("details"),
  // Best-effort client IP, read off the request at the moment of the action
  // (see getClientIp in audit.ts) -- null for anything logged before this
  // column existed, or where no forwarding header was present.
  ipAddress: varchar("ip_address", { length: 64 }),
  // Browser User-Agent -- only captured on sign-in events (login /
  // login_failed), feeding the Audit Log's Devices / Browsers cards. Null on
  // everything else, and on anything logged before the column existed.
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// One row per login, closed out at logout (or left open if the session just
// expired/was abandoned -- lastSeenAt is the fallback "active until" figure
// for active-time math in that case).
export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: uuid("user_id").notNull(),
  userName: varchar("user_name", { length: 100 }),
  userEmail: varchar("user_email", { length: 255 }),
  loginAt: timestamp("login_at", { withTimezone: true }).$defaultFn(() => new Date()),
  logoutAt: timestamp("logout_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).$defaultFn(() => new Date()),
  pageViewCount: integer("page_view_count").default(0),
});

// Individual page navigations within a session -- lightweight, just enough
// for the "Pages" count and a per-user breakdown, not a full analytics tool.
export const pageViews = pgTable("page_views", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: uuid("session_id").notNull(),
  userId: uuid("user_id").notNull(),
  path: varchar("path", { length: 255 }).notNull(),
  viewedAt: timestamp("viewed_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// One row per "Assign Retest" (see reports/[id]/assign-retest/route.ts) --
// a durable record of why a retest was raised: which rated fields the
// original report missed (with the exact rated vs. measured figures, a
// snapshot so it stays meaningful even if the report is later edited/
// deleted), whatever action points the assigning admin typed in, and who's
// who. requisitionId links to the fresh retest requisition that action
// created; reportId to the report that failed. Admin/Central Admin only,
// both to create (Assign Retest) and to browse (Action Registry page).
export const actionRegistry = pgTable("action_registry", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  requisitionId: uuid("requisition_id").notNull(),
  reportId: uuid("report_id").notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  reportNo: varchar("report_no", { length: 20 }),
  unmetFields: varchar("unmet_fields", { length: 100 }).notNull(), // e.g. "Head, Power"
  ratedHead: numeric("rated_head", { precision: 10, scale: 2 }),
  measuredHead: numeric("measured_head", { precision: 10, scale: 2 }),
  ratedCapacity: numeric("rated_capacity", { precision: 10, scale: 4 }),
  measuredCapacity: numeric("measured_capacity", { precision: 10, scale: 4 }),
  ratedPowerKw: numeric("rated_power_kw", { precision: 10, scale: 4 }),
  measuredPowerKw: numeric("measured_power_kw", { precision: 10, scale: 6 }),
  // One action point per line -- simple newline-delimited text rather than a
  // child table, same convention as every other free-text notes field here.
  actionPoints: text("action_points"),
  assignedBy: uuid("assigned_by"),
  // Name snapshot, same convention as test_requisitions.submitted_by -- who
  // clicked "Assign Retest" (always Admin/Central Admin).
  assignedByName: varchar("assigned_by_name", { length: 100 }),
  // Who raised the ORIGINAL testing request that produced the failed report
  // -- the original requisition's submitted_by when this report has a
  // linked requisition, else the report's own tested_by/prepared_by. A name
  // snapshot for the same reason as assignedByName above.
  originallyRaisedBy: varchar("originally_raised_by", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
});

// Testing Calendar (sidebar "Testing Calendar"): pump-testing-related events on a date, e.g. a
// scheduled test, equipment calibration, a team meeting -- not tied to any requisition/report.
// Everyone signed in can see it; only Admin can create/update/delete an event (enforced in the API
// routes, same "Only ___ can ___" pattern the report-delete route already uses).
// createdBy is a REAL FK (unlike test_requisitions.createdBy, which schema.ts doesn't model) since
// this table is new and entirely this app's own -- ON DELETE SET NULL so removing a user's account
// never blocks or cascades into deleting their calendar events; createdByName is a name snapshot,
// same convention as test_requisitions.submitted_by, so the event stays attributable either way.
export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: varchar("title", { length: 200 }).notNull(),
  // The pump model this event is about, if any -- free text (same quick-pick list as a requisition's
  // Model field), not required (a team meeting or calibration isn't about one model).
  model: varchar("model", { length: 100 }),
  // The EC/Quotation No. this event relates to, if any -- searched against the same numbers already
  // on requisitions/reports (see GET /api/calendar-events/ec-options), free text either way so an
  // event can still name one that isn't in the portal yet.
  ecQuotationNo: varchar("ec_quotation_no", { length: 100 }),
  // 'Test' | 'Meeting' | 'Calibration' (CALENDAR_EVENT_TYPES in types/testing.ts). A Test must link a
  // requisition (requisitionNo below); the other two are not tests and complete freely.
  eventType: varchar("event_type", { length: 20 }).notNull().default("Test"),
  // The requisition this event is the test for, by its REQ-000123 number, if any. An event linked to one
  // can only be marked Completed once that requisition's test report has been filed (see
  // lib/calendarCompletion.ts). Plain text, no foreign key.
  requisitionNo: varchar("requisition_no", { length: 20 }),
  // Who the event is for -- the calendar's row grouping (RESPONSIBLE_PERSONS, "Sachin" / "Vikash"),
  // same free-text convention as test_requisitions.responsible_person; null = unassigned, its own row.
  responsiblePerson: varchar("responsible_person", { length: 100 }),
  // 'Planned' | 'In Testing' | 'Completed' -- app-level enum (see CALENDAR_EVENT_STATUSES in types/testing.ts), not
  // a DB constraint, same convention this schema uses everywhere else for a fixed-choice text column.
  status: varchar("status", { length: 20 }).notNull().default("Planned"),
  eventDate: date("event_date").notNull(),
  // Free text like "10:00 AM", same convention as pump_test_reports.pump_started_at -- both optional,
  // an all-day event has neither.
  startTime: varchar("start_time", { length: 20 }),
  endTime: varchar("end_time", { length: 20 }),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdByName: varchar("created_by_name", { length: 100 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date()),
});
