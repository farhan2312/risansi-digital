-- Make "lost to competitor" a value you can count.
--
-- 22 opportunities carry a competitor and they hold 14 distinct spellings, so
-- the same competitor is currently split across up to three rows in any
-- win-rate or competitor analysis. The field was free text before it was a
-- dropdown, and the dropdown then shipped without the master list attached, so
-- everything typed in that window survived as-is.
--
-- Three kinds of value, treated three different ways.

-- 1. A place to record a competitor that is not on the master list.
--    "Others" then means Others, and the name is still kept.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS lost_to_competitor_other text;

COMMENT ON COLUMN opportunities.lost_to_competitor_other IS
  'The competitor named in free text when lost_to_competitor is Others. Never the sole record of who won: lost_to_competitor is what analysis groups on.';

-- 2. Competitors that have actually taken a deal from us and were missing from
--    the master. Each appears in the data below; leaving them in Others would
--    lose the one fact the field exists to capture. Deactivate any of these with
--    UPDATE competitors SET is_active = FALSE WHERE name = '...' if they do not
--    belong there.
INSERT INTO competitors (name, is_active, sort_order)
SELECT v.name, TRUE, 90
  FROM (VALUES ('Flowsys'), ('Alfa Laval'), ('NPI')) AS v(name)
 WHERE NOT EXISTS (SELECT 1 FROM competitors c WHERE lower(c.name) = lower(v.name));

-- 3. The mapping itself.
--
--    Originals are preserved in lost_to_competitor_other wherever the new value
--    is Others, so nothing that was typed is thrown away — "Local Vendor
--    (kolhapur-flowserve)" says more than "Others" does, and both are now kept.
WITH mapping(before, after, keep_text) AS (VALUES
  -- Spelling variants of a master name.
  ('Syno Pumps',                        'Syno',       FALSE),
  ('ROTO Pump',                         'Roto',       FALSE),
  ('PANDEY MAKE',                       'Pandey',     FALSE),
  -- Two spellings of one competitor, now on the master list.
  ('flosys',                            'Flowsys',    FALSE),
  ('Flowsys',                           'Flowsys',    FALSE),
  ('Alfalaval',                         'Alfa Laval', FALSE),
  ('npi',                               'NPI',        FALSE),
  -- The old generic fallback, which is 'Others' on the master list.
  ('Other',                             'Others',     FALSE),
  -- Genuinely not a named competitor. The words are kept beside the bucket.
  ('NOT DISCLOSED',                     'Others',     TRUE),
  ('Name not disclose',                 'Others',     TRUE),
  ('Local Vendor (kolhapur-flowserve)', 'Others',     TRUE)
  -- Deliberately untouched: 'Price — No specific competitor' is a real answer
  -- meaning the deal went on price with nobody named, and 'PSP' and 'Rotomac'
  -- already match the master exactly.
)
UPDATE opportunities o
   SET lost_to_competitor       = m.after,
       lost_to_competitor_other = CASE WHEN m.keep_text THEN o.lost_to_competitor ELSE o.lost_to_competitor_other END,
       updated_at               = NOW()
  FROM mapping m
 WHERE o.lost_to_competitor = m.before
   AND o.lost_to_competitor IS DISTINCT FROM m.after;
