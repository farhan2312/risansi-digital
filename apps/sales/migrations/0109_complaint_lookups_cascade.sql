-- Lists that hang off another list, and the key that has to allow it.
--
-- Three of the new dropdowns only make sense underneath a choice already made:
-- the sub-category under the complaint category, the part name under the part
-- type, the root cause under the root cause category. `parent_value` says which
-- parent a row belongs to, so one table still holds every list.
--
-- `is_user_added` marks a value the Add On control put there rather than a seed.
-- The Complaint Team is being given the right to extend these lists without a
-- deploy, and a later seed must not silently reword or outrank what they added.
--
-- The widened key is the point of this migration. The primary key was
-- (kind, value), which assumes a value appears once per list. Cascading lists
-- break that assumption: Shaft is a part name under External and again under
-- Child Parts of Joints, and they are two different parts to enter an MOC for.
-- Under the old key the second one would collide with the first and be swallowed
-- by ON CONFLICT, leaving the Child Parts list a part short with no error. So
-- identity becomes (kind, value, parent) and Shaft can be in both places.
--
-- Two near misses that are NOT the same problem, since the kind is part of the
-- key either way: Damage is a complaint_category and also a BOI Issue
-- sub-category, and Eccentric Joint is a retired part_type and a live part_name.
-- Different kinds, no collision, nothing to do.
--
-- The key is an expression index rather than a primary key because a primary key
-- cannot contain a nullable column, and parent_value is null for every list that
-- does not cascade. COALESCE to the empty string makes those rows comparable;
-- parent_value itself stays null, so the app can test for a top-level value the
-- obvious way. Every seed from here on infers this index by the same expression.

ALTER TABLE complaint_lookups
  ADD COLUMN IF NOT EXISTS parent_value  text,
  ADD COLUMN IF NOT EXISTS is_user_added boolean NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN complaint_lookups.parent_value IS
  'For a cascading list, the parent choice this value hangs under: the category for a complaint_subcategory, the part type for a part_name, the root cause category for a root_cause_sub. Null for a list that stands on its own.';
COMMENT ON COLUMN complaint_lookups.is_user_added IS
  'True when the Add On control put this value here rather than a migration. Marks it as the Complaint Team''s, so a later seed does not reword or reorder it.';

ALTER TABLE complaint_lookups DROP CONSTRAINT IF EXISTS complaint_lookups_pkey;

CREATE UNIQUE INDEX IF NOT EXISTS complaint_lookups_kind_value_parent_uq
  ON complaint_lookups (kind, value, (COALESCE(parent_value, '')));

COMMENT ON INDEX complaint_lookups_kind_value_parent_uq IS
  'One value per list per parent. Replaces the (kind, value) primary key, which could not hold Shaft under both External and Child Parts of Joints.';
