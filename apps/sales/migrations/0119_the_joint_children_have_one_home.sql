-- The child part names live under Joint, and only under Joint.
--
-- 0118 copied them there and left the originals hanging under "Child Parts of
-- Joints" so the "+ child parts" button would still have a list to read. That
-- left eleven values parented to a part type nobody can choose any more, which
-- the preview check calls out and is right to: a cascading value under a dead
-- parent is invisible, unreachable and the sort of thing that is only ever
-- found by the person wondering why their edit to it did nothing.
--
-- So they are retired here, and the button carries the eleven as a constant
-- instead. They are a fact about how a joint is built rather than a list the
-- Complaint Team revises — and if a twelfth is ever needed, Add On puts it
-- under Joint where it belongs and it is picked from the dropdown like any
-- other part name.
--
-- Retired, not deleted: a complaint filed before 0118 still names its part
-- type as "Child Parts of Joints", and the label it resolves through has to
-- stay for that row to read correctly.

UPDATE complaint_lookups
   SET is_active = FALSE
 WHERE kind = 'part_name' AND parent_value = 'Child Parts of Joints';
