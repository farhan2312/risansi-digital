-- How long a complaint has, by how severe it is.
--
-- Overdue was read off `target_completion_date`, which is only asked on page 5.
-- A complaint that never reaches page 5 has no target, so it can sit open for a
-- hundred days and never be overdue: 34 open complaints and 1 overdue, which is
-- the figure that started this. Overdue is now the age of the complaint — days
-- since it was raised — measured against the days its severity allows.
--
-- The thresholds are a table and not constants because they are a judgement
-- the Complaint Team will revise, and revising them should not need a deploy.
-- Seeded with the provisional set agreed on 2 Oct: a safety or shutdown
-- complaint gets two days, the rest get a week, a fortnight, a month.

CREATE TABLE IF NOT EXISTS complaint_sla_thresholds (
  severity text    PRIMARY KEY CHECK (severity IN ('S1', 'S2', 'S3', 'S4')),
  days     integer NOT NULL CHECK (days > 0)
);

COMMENT ON TABLE complaint_sla_thresholds IS
  'Days allowed per severity before an open complaint counts as overdue, measured from the day it was raised. Editable in Admin — the figures are the Complaint Team''s call, not the code''s.';
COMMENT ON COLUMN complaint_sla_thresholds.severity IS
  'S1 to S4, as computed on page 3 and stored on complaints.severity.';
COMMENT ON COLUMN complaint_sla_thresholds.days IS
  'Days from the raised date within which a complaint of this severity is expected to be closed.';

INSERT INTO complaint_sla_thresholds (severity, days) VALUES
  ('S1',  2),
  ('S2',  7),
  ('S3', 15),
  ('S4', 30)
-- DO NOTHING, not DO UPDATE: once the Complaint Team has set a figure in Admin
-- it outranks the seed, and this file should never put the provisional one back.
ON CONFLICT (severity) DO NOTHING;
