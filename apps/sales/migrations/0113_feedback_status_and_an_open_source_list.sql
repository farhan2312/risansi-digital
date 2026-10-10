-- Feedback is a stage, and the source list stops being closed.
--
-- 1. Feedback. Closure and feedback were the same moment: a complaint went
--    Resolved and then Closed, and whether the client had been asked how it
--    went was not a state anyone could filter on. The headline status the
--    dashboard shows is Open / Action Taken / Resolved / Feedback / Closed, so
--    Feedback has to be a status a complaint can actually sit in, between
--    resolving it and closing it.
--
--    The five legacy values stay legal. Nothing is on In Progress or Awaiting
--    Client today, but the constraint is not the place to assert that.
--
-- 2. The source list. `channel` carried a check constraint naming six sources,
--    which contradicts the Add On control page 1 is getting: the first source
--    the Complaint Team adds in Admin — the list itself now allows any — would
--    be offered in the dropdown and then rejected on save, with the failure
--    surfacing as a complaint that would not register. The check goes; the
--    `source` lookup is the list, and it is editable, which is the point.
--    Blank is still not a source, so the column is held to a non-empty string.

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_status_chk;
ALTER TABLE complaints ADD CONSTRAINT complaints_status_chk CHECK (status = ANY (ARRAY[
  'Open', 'In Progress', 'Awaiting Client', 'Resolved', 'Closed',
  'Under Investigation', 'Action Pending', 'Replacement Pending',
  'Customer Confirmation Pending', 'Feedback'
]));

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_channel_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_channel_check
  CHECK (channel IS NULL OR length(btrim(channel)) > 0);

COMMENT ON COLUMN complaints.channel IS
  'How the complaint reached us. Validated against the source lookup, which the Complaint Team extends in Admin, rather than against a list fixed in the schema.';
