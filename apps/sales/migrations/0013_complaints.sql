-- 0013  Complaints module.
--
-- A complaint is raised by a rep against one of their clients and escalated to
-- a responsible person (an internal user or an external name), then worked
-- through a status pipeline. It mirrors the "action registry" (tasks) but with
-- warranty/service-specific fields (part, pump model, invoice/PO) and a
-- threaded resolution log (complaint_updates) plus optional photos.
--
-- Visibility (enforced in the app, not here): admin/sysadmin see all;
-- rep/manager see complaints for clients on their tours OR assigned to them.

CREATE TABLE IF NOT EXISTS complaints (
  id                serial PRIMARY KEY,
  complaint_no      text NOT NULL UNIQUE,            -- display ref, e.g. CMP-0166
  legacy_ref        text,                            -- original sheet "Complaint No." (historical)
  client_id         integer REFERENCES clients(id),
  client_code       text,
  channel           text,                            -- Verbal | Email | Mail
  complaint_date    date,
  details           text NOT NULL,
  part_name         text,
  quantity          integer,
  pump_model        text,
  invoice_no        text,
  invoice_date      date,
  client_po_no      text,
  client_po_date    date,
  priority          text NOT NULL DEFAULT 'Medium',
  status            text NOT NULL DEFAULT 'Open',
  due_date          date,
  assigned_to_user      integer REFERENCES users(id),
  assigned_to_external  text,
  reported_by_raw       text,                        -- original RIL REP initials (historical)
  reported_by_user      integer REFERENCES users(id),
  root_cause        text,
  resolution        text,
  source            text NOT NULL DEFAULT 'app',     -- app | import
  created_by        text,
  resolved_at       timestamptz,
  resolved_by       text,
  closed_at         timestamptz,
  closed_by         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT complaints_status_chk   CHECK (status   IN ('Open','In Progress','Awaiting Client','Resolved','Closed')),
  CONSTRAINT complaints_priority_chk CHECK (priority IN ('High','Medium','Low'))
);
CREATE INDEX IF NOT EXISTS idx_complaints_client   ON complaints(client_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status   ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_assigned ON complaints(assigned_to_user);

-- Threaded resolution log (the historical Remarks column becomes a series of
-- these). entry_date holds the date parsed from a dated remark line, if any.
CREATE TABLE IF NOT EXISTS complaint_updates (
  id            serial PRIMARY KEY,
  complaint_id  integer NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  body          text NOT NULL,
  entry_date    date,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_complaint_updates_complaint ON complaint_updates(complaint_id, created_at);

-- Photo attachments (same in-DB bytea approach as visit_photos).
CREATE TABLE IF NOT EXISTS complaint_photos (
  id            serial PRIMARY KEY,
  complaint_id  integer NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  image_bytes   bytea NOT NULL,
  mime_type     text NOT NULL DEFAULT 'image/jpeg',
  byte_size     integer,
  caption       text DEFAULT '',
  uploaded_by   text,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT complaint_photos_size_chk CHECK (octet_length(image_bytes) <= 15000000)
);
CREATE INDEX IF NOT EXISTS idx_complaint_photos_complaint ON complaint_photos(complaint_id, uploaded_at);
