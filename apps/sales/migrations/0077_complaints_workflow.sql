-- The complaint workflow: eight pages, one status, a lifecycle, and lookups.
--
-- Built to the revised specification of 11 Sep 2026 and the decisions of 12–13
-- Sep (see the plan). Everything here is additive: the 183 complaints already
-- on file keep every column they have, and a `schema_version` tells the pages
-- whether a row is a legacy complaint (1 — shown as it is, asked for nothing)
-- or one that lives in the workflow (2). The 13 in flight are moved into the
-- workflow at the status that matches where they are; the 170 closed and
-- resolved are frozen as legacy.
--
-- One status, not two. The specification carried a seven-value Complaint
-- Status on Page 5 and a separate Closure Decision on Page 8, which would have
-- disagreed within a week. `status` is the one state; Reopen and Close are
-- transitions recorded in complaint_stage_log, and Closure Decision is the two
-- buttons that make them.

-- ── 1. The record ────────────────────────────────────────────────────────────

ALTER TABLE complaints ADD COLUMN IF NOT EXISTS schema_version smallint NOT NULL DEFAULT 1;
COMMENT ON COLUMN complaints.schema_version IS '1 = legacy record shown as-is; 2 = lives in the eight-page workflow (migration 0077).';

-- Statuses: the legacy five stay legal for legacy rows; the workflow's seven
-- join them. Severity is computed, never typed (see severityOf in
-- lib/risansi-complaint-flow.ts) and stored beside the answers that made it.
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_status_chk;
ALTER TABLE complaints ADD CONSTRAINT complaints_status_chk CHECK (status = ANY (ARRAY[
  'Open', 'In Progress', 'Awaiting Client', 'Resolved', 'Closed',
  'Under Investigation', 'Action Pending', 'Replacement Pending', 'Customer Confirmation Pending'
]));

-- Complaint Source takes the specification's list; the two legacy values stay legal.
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_channel_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_channel_check CHECK (channel IS NULL OR channel = ANY (ARRAY[
  'Verbal', 'Email', 'Call', 'Visit', 'Portal', 'Other'
]));

-- Page 1 — Registration
ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS complaint_type          text CHECK (complaint_type IS NULL OR complaint_type IN ('Technical', 'Non-technical')),
  ADD COLUMN IF NOT EXISTS defect_category         text,
  ADD COLUMN IF NOT EXISTS defect_reason           text,
  ADD COLUMN IF NOT EXISTS responsible_department  text,
  ADD COLUMN IF NOT EXISTS contact_person          text,
  ADD COLUMN IF NOT EXISTS contact_detail          text,
  ADD COLUMN IF NOT EXISTS rep_user_id             integer REFERENCES users(id);

-- Page 2 — Order & Pump. All typed for now (decided 12 Sep); EC No. and Pump
-- Serial No. look up the installed base to pre-fill, every field editable.
ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS so_no                   text,
  ADD COLUMN IF NOT EXISTS ec_no                   text,
  ADD COLUMN IF NOT EXISTS ec_date                 date,
  ADD COLUMN IF NOT EXISTS ec_made_by              text,
  ADD COLUMN IF NOT EXISTS basic_value             numeric(14,2),
  ADD COLUMN IF NOT EXISTS pump_serial_no          text,
  ADD COLUMN IF NOT EXISTS internal_model_no       text,
  ADD COLUMN IF NOT EXISTS model_version           text,
  ADD COLUMN IF NOT EXISTS liquid                  text,
  ADD COLUMN IF NOT EXISTS rubber_moc              text,
  ADD COLUMN IF NOT EXISTS head_pressure           text,
  ADD COLUMN IF NOT EXISTS part_type               text,
  ADD COLUMN IF NOT EXISTS stator_code             text,
  ADD COLUMN IF NOT EXISTS mfg_date                date;

-- Page 3 — Risk & Criticality. Eleven yes/no answers and the level they make.
ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS risk_safety             boolean,
  ADD COLUMN IF NOT EXISTS risk_shutdown           boolean,
  ADD COLUMN IF NOT EXISTS risk_penalty            boolean,
  ADD COLUMN IF NOT EXISTS risk_pump_failure       boolean,
  ADD COLUMN IF NOT EXISTS risk_major_perf         boolean,
  ADD COLUMN IF NOT EXISTS risk_head_mismatch      boolean,
  ADD COLUMN IF NOT EXISTS risk_repeat_failure     boolean,
  ADD COLUMN IF NOT EXISTS risk_repeat_mistake     boolean,
  ADD COLUMN IF NOT EXISTS risk_cost_impact        boolean,
  ADD COLUMN IF NOT EXISTS risk_workable           boolean,
  ADD COLUMN IF NOT EXISTS risk_qty_over_5         boolean,
  ADD COLUMN IF NOT EXISTS severity                text CHECK (severity IS NULL OR severity IN ('S1', 'S2', 'S3', 'S4')),
  ADD COLUMN IF NOT EXISTS warning_letter          text CHECK (warning_letter IS NULL OR warning_letter IN ('Yes', 'No', 'Issued', 'NA'));

-- Page 4 — Investigation & Root Cause
ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS analysis_required       boolean,
  ADD COLUMN IF NOT EXISTS investigation_assigned_to integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS investigation_start     date,
  ADD COLUMN IF NOT EXISTS investigation_end       date,
  ADD COLUMN IF NOT EXISTS root_cause_category     text,
  ADD COLUMN IF NOT EXISTS internal_remarks        text,
  ADD COLUMN IF NOT EXISTS corrective_action_required boolean,
  ADD COLUMN IF NOT EXISTS preventive_action       text;

-- Page 5 — Corrective Action & Resolution
ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS action_against          text,
  ADD COLUMN IF NOT EXISTS action_category         text,
  ADD COLUMN IF NOT EXISTS action_assigned_to      integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS target_completion_date  date,
  ADD COLUMN IF NOT EXISTS actual_completion_date  date,
  ADD COLUMN IF NOT EXISTS fr_ec_no                text,
  ADD COLUMN IF NOT EXISTS fr_ec_date              date,
  ADD COLUMN IF NOT EXISTS challan_no              text,
  ADD COLUMN IF NOT EXISTS challan_date            date,
  ADD COLUMN IF NOT EXISTS target_dispatch_date    date,
  ADD COLUMN IF NOT EXISTS challan_value           numeric(14,2),
  ADD COLUMN IF NOT EXISTS fr_freight              numeric(14,2),
  ADD COLUMN IF NOT EXISTS status_remarks          text,
  ADD COLUMN IF NOT EXISTS customer_confirmed      boolean;

-- Page 6 — Vendor CAPA & Documents. The CAPA report itself is an attachment.
ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS boi_involved            boolean,
  ADD COLUMN IF NOT EXISTS vendor_name             text,
  ADD COLUMN IF NOT EXISTS vendor_recovery         boolean,
  ADD COLUMN IF NOT EXISTS capa_required           boolean,
  ADD COLUMN IF NOT EXISTS capa_received_date      date,
  ADD COLUMN IF NOT EXISTS drive_link              text;

-- Page 7 — Returnable Material & Follow-up
ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS material_returnable     boolean,
  ADD COLUMN IF NOT EXISTS returnable_owner        integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS returnable_slip_no      text,
  ADD COLUMN IF NOT EXISTS returnable_slip_date    date,
  ADD COLUMN IF NOT EXISTS gr_no                   text,
  ADD COLUMN IF NOT EXISTS paid_to_pay             text CHECK (paid_to_pay IS NULL OR paid_to_pay IN ('Paid', 'To Pay')),
  ADD COLUMN IF NOT EXISTS returnable_amount       numeric(14,2),
  ADD COLUMN IF NOT EXISTS returnable_item_value   numeric(14,2),
  ADD COLUMN IF NOT EXISTS returnable_status       text,
  ADD COLUMN IF NOT EXISTS first_email_date        date,
  ADD COLUMN IF NOT EXISTS last_reminder_date      date,
  ADD COLUMN IF NOT EXISTS next_followup_date      date,
  ADD COLUMN IF NOT EXISTS followup_remarks        text,
  ADD COLUMN IF NOT EXISTS accounts_action         text,
  ADD COLUMN IF NOT EXISTS mgmt_intervention       boolean,
  ADD COLUMN IF NOT EXISTS returnable_action       text;

-- Page 8 — Closure & Management Review
ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS closure_summary         text,
  ADD COLUMN IF NOT EXISTS customer_satisfied      boolean,
  ADD COLUMN IF NOT EXISTS reopen_reason           text,
  ADD COLUMN IF NOT EXISTS reopen_count            integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS repeat_complaint        boolean,
  ADD COLUMN IF NOT EXISTS action_effectiveness    text,
  ADD COLUMN IF NOT EXISTS lessons_learned         text,
  ADD COLUMN IF NOT EXISTS management_remarks      text;

-- ── 2. Lookups — every dropdown, editable without a deploy ──────────────────

CREATE TABLE IF NOT EXISTS complaint_lookups (
  kind       text    NOT NULL,
  value      text    NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  is_active  boolean NOT NULL DEFAULT TRUE,
  PRIMARY KEY (kind, value)
);
COMMENT ON TABLE complaint_lookups IS
  'The option lists of the complaint module, by kind. Seeded from the specification; QC and the Complaint Team add to them from Admin without a deploy.';

INSERT INTO complaint_lookups (kind, value, sort_order) VALUES
  ('source', 'Email', 1), ('source', 'Call', 2), ('source', 'Visit', 3), ('source', 'Portal', 4), ('source', 'Other', 5),
  ('complaint_type', 'Technical', 1), ('complaint_type', 'Non-technical', 2),
  ('defect_category', 'Abnormal noise / vibration issue', 1), ('defect_category', 'Assembly related', 2),
  ('defect_category', 'Capacity issue', 3), ('defect_category', 'Client issue', 4), ('defect_category', 'Damage', 5),
  ('defect_category', 'Drawing / design related', 6), ('defect_category', 'Gearbox', 7), ('defect_category', 'Leakage', 8),
  ('defect_category', 'Motor', 9), ('defect_category', 'Supply related (short / wrong / excess)', 10),
  ('defect_reason', 'Application engineering', 1), ('defect_reason', 'Client mistake', 2), ('defect_reason', 'Design failure', 3),
  ('defect_reason', 'EC preparation', 4), ('defect_reason', 'Excess vibration gearbox', 5), ('defect_reason', 'Excess vibration in motor', 6),
  ('defect_reason', 'External part damage', 7), ('defect_reason', 'Flow issue', 8), ('defect_reason', 'Internal part damage', 9),
  ('defect_reason', 'Jamming issue', 10), ('defect_reason', 'Leakage from gland', 11), ('defect_reason', 'Leakage from mechanical seal', 12),
  ('defect_reason', 'Leakage from stator side', 13), ('defect_reason', 'No issue', 14), ('defect_reason', 'Packing & dispatch', 15),
  ('defect_reason', 'Probe setting issue', 16), ('defect_reason', 'Sound coming from gear box', 17), ('defect_reason', 'Sound coming from pump', 18),
  ('defect_reason', 'Stator damage', 19), ('defect_reason', 'Transit damage', 20), ('defect_reason', 'Vendor', 21),
  ('defect_reason', 'Vibration issue', 22), ('defect_reason', 'Wrong selection', 23),
  ('responsible_department', 'Billing Team', 1), ('responsible_department', 'Drawing Team', 2), ('responsible_department', 'Packing & Dispatch', 3),
  ('responsible_department', 'QC & Production', 4), ('responsible_department', 'Quotation Team', 5), ('responsible_department', 'Rubber Dept', 6),
  ('part_type', 'BOI', 1), ('part_type', 'Universal Joint', 2), ('part_type', 'Eccentric Joint', 3),
  ('part_type', 'External', 4), ('part_type', 'Internal', 5), ('part_type', 'Rubber parts', 6),
  ('action_category', 'Service (Site Visit)', 1), ('action_category', 'Free Replacement', 2), ('action_category', 'Paid Replacement', 3),
  ('action_category', 'Repair', 4), ('action_category', 'Online Technical Support', 5), ('action_category', 'Other', 6),
  ('returnable_status', 'Pending', 1), ('returnable_status', 'In Transit', 2), ('returnable_status', 'Received', 3), ('returnable_status', 'Closed', 4),
  ('effectiveness', 'Effective', 1), ('effectiveness', 'Partially Effective', 2), ('effectiveness', 'Not Effective', 3), ('effectiveness', 'N/A', 4),
  ('root_cause_category', 'Manufacturing', 1), ('root_cause_category', 'Design', 2), ('root_cause_category', 'Material', 3),
  ('root_cause_category', 'Assembly', 4), ('root_cause_category', 'Installation', 5), ('root_cause_category', 'Operation', 6),
  ('root_cause_category', 'Customer', 7), ('root_cause_category', 'Vendor', 8), ('root_cause_category', 'Other', 9),
  -- A seed, not a specification: the sheet left Accounts Action empty. Billing edits it.
  ('accounts_action', 'None required', 1), ('accounts_action', 'Credit note', 2), ('accounts_action', 'Debit note', 3),
  ('accounts_action', 'Invoice raised', 4), ('accounts_action', 'Payment received', 5), ('accounts_action', 'Written off', 6)
ON CONFLICT DO NOTHING;

-- ── 3. The lifecycle — who held it, from when to when ───────────────────────
--
-- One row per status change. `holder` is who is accountable while the
-- complaint sits in `to_status`: a department, and the person when one is
-- named (the investigation assignee, the action assignee, the returnable
-- owner). Dwell is the gap to the next row, so "who sits on tickets longest"
-- is a query over this table, not a guess.

CREATE TABLE IF NOT EXISTS complaint_stage_log (
  id                 bigserial PRIMARY KEY,
  complaint_id       integer     NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  from_status        text,
  to_status          text        NOT NULL,
  holder_department  text,
  holder_user_id     integer     REFERENCES users(id),
  note               text,
  actor_email        text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_complaint_stage_log_c ON complaint_stage_log (complaint_id, created_at);

-- ── 4. Attachments — one table, five slots ──────────────────────────────────

CREATE TABLE IF NOT EXISTS complaint_attachments (
  id           bigserial PRIMARY KEY,
  complaint_id integer     NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  category     text        NOT NULL CHECK (category IN ('complaint', 'photo', 'capa', 'customer', 'other')),
  file_name    text        NOT NULL,
  mime_type    text        NOT NULL,
  byte_size    integer     NOT NULL,
  bytes        bytea       NOT NULL,
  caption      text,
  uploaded_by  text,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_complaint_attachments_c ON complaint_attachments (complaint_id, category);
COMMENT ON TABLE complaint_attachments IS
  'Every file on a complaint: complaint attachments (page 1), photos, the CAPA report (page 6 — the closure gate for S1/S2 reads this), customer communication, other (MOM).';

-- The eleven photos already on file come across as photos.
INSERT INTO complaint_attachments (complaint_id, category, file_name, mime_type, byte_size, bytes, caption, uploaded_by, uploaded_at)
SELECT p.complaint_id, 'photo', COALESCE(NULLIF(p.caption, ''), 'photo-' || p.id) || CASE WHEN p.mime_type LIKE '%png%' THEN '.png' ELSE '.jpg' END,
       p.mime_type, p.byte_size, p.image_bytes, p.caption, p.uploaded_by, p.uploaded_at
  FROM complaint_photos p
 WHERE NOT EXISTS (SELECT 1 FROM complaint_attachments a WHERE a.complaint_id = p.complaint_id AND a.uploaded_at = p.uploaded_at AND a.byte_size = p.byte_size);

-- ── 5. The records already on file ──────────────────────────────────────────
--
-- Closed and Resolved: frozen as legacy (schema_version 1), untouched.
-- In flight: enter the workflow where they stand.

UPDATE complaints SET schema_version = 2, status = 'Under Investigation', updated_at = now()
 WHERE status = 'In Progress';
UPDATE complaints SET schema_version = 2, status = 'Customer Confirmation Pending', updated_at = now()
 WHERE status = 'Awaiting Client';
UPDATE complaints SET schema_version = 2, updated_at = now()
 WHERE status = 'Open';

-- A lifecycle for every complaint that has one: the day it was raised, then
-- each status change the old update log recorded ("Status changed to X").
INSERT INTO complaint_stage_log (complaint_id, from_status, to_status, holder_department, actor_email, created_at)
SELECT c.id, NULL, 'Open', 'Complaint Team', c.created_by, c.created_at
  FROM complaints c
 WHERE NOT EXISTS (SELECT 1 FROM complaint_stage_log l WHERE l.complaint_id = c.id);

INSERT INTO complaint_stage_log (complaint_id, from_status, to_status, holder_department, actor_email, note, created_at)
SELECT u.complaint_id, NULL,
       CASE substring(u.body FROM 'Status changed to (.*)$')
         WHEN 'In Progress'     THEN 'Under Investigation'
         WHEN 'Awaiting Client' THEN 'Customer Confirmation Pending'
         ELSE substring(u.body FROM 'Status changed to (.*)$') END,
       'Complaint Team', u.created_by, 'from the update log', u.created_at
  FROM complaint_updates u
 WHERE u.body LIKE 'Status changed to %'
   AND NOT EXISTS (SELECT 1 FROM complaint_stage_log l WHERE l.complaint_id = u.complaint_id AND l.created_at = u.created_at);

-- Closed legacy rows: a final row at the close, so their lifecycle ends.
INSERT INTO complaint_stage_log (complaint_id, from_status, to_status, holder_department, actor_email, created_at)
SELECT c.id, NULL, c.status, 'Complaint Team', COALESCE(c.closed_by, c.resolved_by), COALESCE(c.closed_at, c.resolved_at)
  FROM complaints c
 WHERE c.status IN ('Closed', 'Resolved') AND COALESCE(c.closed_at, c.resolved_at) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM complaint_stage_log l WHERE l.complaint_id = c.id AND l.to_status = c.status);
