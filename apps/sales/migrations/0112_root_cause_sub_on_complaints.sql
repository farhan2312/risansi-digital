-- The root cause, one level finer than its category.
--
-- Page 4 now asks the category (Human Error, Design, Process) and then the
-- cause within it, and the second answer had nowhere to go: `root_cause` is the
-- free-text account of what happened and `root_cause_category` holds only the
-- heading. A field the form offers and cannot save is worse than one it never
-- offered, so the column goes in with the three-value category list of 0111.
--
-- Left empty on the fifteen records that already name a root cause category.
-- Their categories are the retired nine, which have no sub-causes to choose
-- from; the account they wrote in `root_cause` is still there and still reads.

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS root_cause_sub text;

COMMENT ON COLUMN complaints.root_cause_sub IS
  'The cause within the root cause category — the root_cause_sub lookup, filtered by parent_value = root_cause_category. Drives the responsible department, which is derived here rather than asked for on page 1.';
