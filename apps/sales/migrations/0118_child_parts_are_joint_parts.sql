-- "Child Parts of Joints" stops being a part type.
--
-- It was never one. The four real part types are what a part IS — Rubber Part,
-- BOI, External, Joint — and "Child Parts of Joints" was a heading for a list
-- of names, sitting in the same dropdown as though it were a fifth kind of
-- part. The Complaint Team asked for it to go, and they are right: a Bush is
-- not a different type of part from a joint, it is a part OF one.
--
-- So the eleven children now hang under Joint as well, which is what a row
-- holding one should say: Part type Joint, Part name Bush. Joint's name list
-- grows from four assemblies to fifteen, and every one of them is something a
-- joint complaint can actually be about.
--
-- The rows under the old parent stay active and are NOT deleted. Nothing shows
-- them — a part-name list is only ever read for the type that was chosen, and
-- that type is no longer offered — but they are what the "+ child parts"
-- button reads to know which eleven to add. The parent value is a key for that
-- list, not an entry in any dropdown.
--
-- Complaints already filed against the old type keep it. The parts editor
-- renders a stored value that is no longer offered rather than dropping it, so
-- an existing row still reads correctly.

INSERT INTO complaint_lookups (kind, value, parent_value, sort_order, is_active)
SELECT 'part_name', value, 'Joint', 100 + sort_order, TRUE
  FROM complaint_lookups
 WHERE kind = 'part_name' AND parent_value = 'Child Parts of Joints'
ON CONFLICT (kind, value, (COALESCE(parent_value, ''))) DO UPDATE
  SET is_active = TRUE
  WHERE complaint_lookups.is_user_added = FALSE;

UPDATE complaint_lookups
   SET is_active = FALSE
 WHERE kind = 'part_type' AND value = 'Child Parts of Joints';

COMMENT ON TABLE complaint_lookups IS
  'Every dropdown the complaint module offers. parent_value makes a list hang under another answer; a value with is_user_added = TRUE was added by the Complaint Team from the form or Admin and is never overwritten by a re-seed.';
