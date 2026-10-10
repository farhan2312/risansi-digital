-- Every dropdown the rebuilt complaint form offers.
--
-- Seeded from the requirement of 2 Oct. The cascading lists carry the parent
-- they hang under, so the sub-category list filters by the category chosen and
-- the part name list by the part type; sort_order is the order the requirement
-- gives them in, which is the order the Complaint Team reads them in.
--
-- Client Related is seeded with no sub-categories on purpose. That list is
-- still with the Complaint Team; an invented placeholder would be answered and
-- then have to be unpicked, so the Add On control fills it when the list lands.
--
-- Two part types leave the list. Internal and Rubber parts predate the five the
-- requirement settles on and have no part names under them, so offering them
-- would give the user a dropdown that cascades into nothing. They are
-- deactivated rather than deleted — the one complaint filed against Rubber
-- parts and the four against Internal still resolve their labels.
--
-- Verbal and WhatsApp join the source list. Verbal is how 130 of the 219
-- complaints on file arrived and was never in the list, so those records showed
-- a source the dropdown denied existed.
--
-- Every insert infers the (kind, value, parent) index from 0109. DO UPDATE
-- reactivates and re-sorts a seeded row, and skips a row the Complaint Team
-- added themselves, whose wording and position are theirs.

-- ── The five categories ─────────────────────────────────────────────────────

INSERT INTO complaint_lookups (kind, value, parent_value, sort_order, is_active) VALUES
  ('complaint_category', 'Supply Related', NULL, 1, TRUE),
  ('complaint_category', 'BOI Issue',      NULL, 2, TRUE),
  ('complaint_category', 'Performance',    NULL, 3, TRUE),
  ('complaint_category', 'Damage',         NULL, 4, TRUE),
  ('complaint_category', 'Client Related', NULL, 5, TRUE)
ON CONFLICT (kind, value, (COALESCE(parent_value, ''))) DO UPDATE
  SET sort_order = EXCLUDED.sort_order, is_active = TRUE
  WHERE complaint_lookups.is_user_added = FALSE;

-- ── Sub-categories, under the category they belong to ───────────────────────

INSERT INTO complaint_lookups (kind, value, parent_value, sort_order, is_active) VALUES
  ('complaint_subcategory', 'Excess',               'Supply Related', 1, TRUE),
  ('complaint_subcategory', 'Short',                'Supply Related', 2, TRUE),
  ('complaint_subcategory', 'Wrong',                'Supply Related', 3, TRUE),
  ('complaint_subcategory', 'Drawing Mismatch',     'Supply Related', 4, TRUE),

  ('complaint_subcategory', 'Vibration',            'BOI Issue',      1, TRUE),
  ('complaint_subcategory', 'Noise',                'BOI Issue',      2, TRUE),
  ('complaint_subcategory', 'Damage',               'BOI Issue',      3, TRUE),
  ('complaint_subcategory', 'Heat',                 'BOI Issue',      4, TRUE),
  ('complaint_subcategory', 'Leakage',              'BOI Issue',      5, TRUE),
  ('complaint_subcategory', 'Other',                'BOI Issue',      6, TRUE),

  ('complaint_subcategory', 'Capacity',             'Performance',    1, TRUE),
  ('complaint_subcategory', 'Head',                 'Performance',    2, TRUE),
  ('complaint_subcategory', 'Not Rotating (Jammed)','Performance',    3, TRUE),

  ('complaint_subcategory', 'Rubber Part',          'Damage',         1, TRUE),
  ('complaint_subcategory', 'Joint',                'Damage',         2, TRUE),
  ('complaint_subcategory', 'External',             'Damage',         3, TRUE)
ON CONFLICT (kind, value, (COALESCE(parent_value, ''))) DO UPDATE
  SET sort_order = EXCLUDED.sort_order, is_active = TRUE
  WHERE complaint_lookups.is_user_added = FALSE;

-- ── Part types, and the parts under each ────────────────────────────────────

INSERT INTO complaint_lookups (kind, value, parent_value, sort_order, is_active) VALUES
  ('part_type', 'Rubber Part',           NULL, 1, TRUE),
  ('part_type', 'BOI',                   NULL, 2, TRUE),
  ('part_type', 'External',              NULL, 3, TRUE),
  ('part_type', 'Joint',                 NULL, 4, TRUE),
  ('part_type', 'Child Parts of Joints', NULL, 5, TRUE)
ON CONFLICT (kind, value, (COALESCE(parent_value, ''))) DO UPDATE
  SET sort_order = EXCLUDED.sort_order, is_active = TRUE
  WHERE complaint_lookups.is_user_added = FALSE;

UPDATE complaint_lookups
   SET is_active = FALSE
 WHERE kind = 'part_type' AND value IN ('Internal', 'Rubber parts');

INSERT INTO complaint_lookups (kind, value, parent_value, sort_order, is_active) VALUES
  ('part_name', 'Stator',          'Rubber Part', 1, TRUE),
  ('part_name', 'Seal Ring',       'Rubber Part', 2, TRUE),
  ('part_name', 'Sleeve Ring',     'Rubber Part', 3, TRUE),
  ('part_name', 'Boot Seal',       'Rubber Part', 4, TRUE),

  ('part_name', 'Mechanical Seal', 'BOI',         1, TRUE),
  ('part_name', 'Gear Box',        'BOI',         2, TRUE),
  ('part_name', 'Motor',           'BOI',         3, TRUE),
  ('part_name', 'PRV',             'BOI',         4, TRUE),
  ('part_name', 'Strainer',        'BOI',         5, TRUE),
  ('part_name', 'DRP',             'BOI',         6, TRUE),

  ('part_name', 'Bearing Housing', 'External',    1, TRUE),
  ('part_name', 'Pump Housing',    'External',    2, TRUE),
  ('part_name', 'End Plate',       'External',    3, TRUE),
  ('part_name', 'Rotor',           'External',    4, TRUE),
  ('part_name', 'Shaft',           'External',    5, TRUE),

  ('part_name', 'Eccentric Joint', 'Joint',       1, TRUE),
  ('part_name', 'CJ',              'Joint',       2, TRUE),
  ('part_name', 'CJ2',             'Joint',       3, TRUE),
  ('part_name', 'CJMS',            'Joint',       4, TRUE),

  -- Shaft again, under a different parent. This is the pair the old
  -- (kind, value) key could not hold; see 0109.
  ('part_name', 'Bush',            'Child Parts of Joints',  1, TRUE),
  ('part_name', 'Protector',       'Child Parts of Joints',  2, TRUE),
  ('part_name', 'Shaft',           'Child Parts of Joints',  3, TRUE),
  ('part_name', 'Shaft Head',      'Child Parts of Joints',  4, TRUE),
  ('part_name', 'Rotor Head',      'Child Parts of Joints',  5, TRUE),
  ('part_name', 'Connecting Rod',  'Child Parts of Joints',  6, TRUE),
  ('part_name', 'Sleeve',          'Child Parts of Joints',  7, TRUE),
  ('part_name', 'Pin',             'Child Parts of Joints',  8, TRUE),
  ('part_name', 'Dowel Pin',       'Child Parts of Joints',  9, TRUE),
  ('part_name', 'Threaded Pin',    'Child Parts of Joints', 10, TRUE),
  ('part_name', 'Head Pin',        'Child Parts of Joints', 11, TRUE)
ON CONFLICT (kind, value, (COALESCE(parent_value, ''))) DO UPDATE
  SET sort_order = EXCLUDED.sort_order, is_active = TRUE
  WHERE complaint_lookups.is_user_added = FALSE;

-- ── Who prepared the EC ─────────────────────────────────────────────────────
--
-- Typed before, so the same person arrived spelled three ways and could not be
-- counted. The nine the drawing office actually has, by name.

INSERT INTO complaint_lookups (kind, value, parent_value, sort_order, is_active) VALUES
  ('ec_made_by', 'Amit Sharma', NULL, 1, TRUE),
  ('ec_made_by', 'Rachna',      NULL, 2, TRUE),
  ('ec_made_by', 'Prashant',    NULL, 3, TRUE),
  ('ec_made_by', 'Umesh',       NULL, 4, TRUE),
  ('ec_made_by', 'Amit Verma',  NULL, 5, TRUE),
  ('ec_made_by', 'Parul Pal',   NULL, 6, TRUE),
  ('ec_made_by', 'Ananya',      NULL, 7, TRUE),
  ('ec_made_by', 'Partha',      NULL, 8, TRUE),
  ('ec_made_by', 'Arpit',       NULL, 9, TRUE)
ON CONFLICT (kind, value, (COALESCE(parent_value, ''))) DO UPDATE
  SET sort_order = EXCLUDED.sort_order, is_active = TRUE
  WHERE complaint_lookups.is_user_added = FALSE;

-- ── How the complaint reached us ────────────────────────────────────────────

INSERT INTO complaint_lookups (kind, value, parent_value, sort_order, is_active) VALUES
  ('source', 'Verbal',   NULL, 1, TRUE),
  ('source', 'Email',    NULL, 2, TRUE),
  ('source', 'Call',     NULL, 3, TRUE),
  ('source', 'WhatsApp', NULL, 4, TRUE),
  ('source', 'Visit',    NULL, 5, TRUE),
  ('source', 'Portal',   NULL, 6, TRUE),
  ('source', 'Other',    NULL, 7, TRUE)
ON CONFLICT (kind, value, (COALESCE(parent_value, ''))) DO UPDATE
  SET sort_order = EXCLUDED.sort_order, is_active = TRUE
  WHERE complaint_lookups.is_user_added = FALSE;
