-- The old defect categories, read onto the new ones where they say enough.
--
-- 219 complaints are on file. 183 of them never answered `defect_category` at
-- all — they are the legacy records that predate the eight-page form — and the
-- remaining 36 are spread over nine values. This fills in `complaint_category`
-- for the 31 where the old answer maps without a guess, and leaves the other
-- 188 empty.
--
--   Supply related (short / wrong / excess)  17 → Supply Related, no sub
--   Damage                                    9 → Damage
--   Client issue                              2 → Client Related
--   Capacity issue                            1 → Performance / Capacity
--   Short supply                              1 → Supply Related / Short
--   Wrong supply                              1 → Supply Related / Wrong
--
-- The combined supply value keeps no sub-category on purpose: it means short or
-- wrong or excess and does not say which, and picking one would invent an
-- answer that then gets counted. Same for eight of the nine Damage records; the
-- ninth names its part type as a rubber part, which is a sub-category the new
-- list has, so that one gets Rubber Part. The two filed as Internal name pins,
-- which are child parts of a joint, but Internal is not one of Damage's three
-- sub-categories and reading it as Joint is a step past what the record says.
--
-- Left empty deliberately, five rows:
--   Drawing / design related   3 — a design fault and a drawing mismatch on a
--                                  supply are different complaints, and the old
--                                  value covered both
--   Abnormal noise / vibration 1 — Noise and Vibration are two sub-categories
--                                  and the record does not choose
--   Leakage                    1 — only BOI Issue has a Leakage sub-category,
--                                  and this one's reason is application
--                                  engineering, which is not a bought-out item
--
-- Gearbox and Motor are mapped although no record carries either: both are
-- bought-out items and nothing else they could be, so if one is filed before
-- this runs it lands correctly.
--
-- `defect_category` is not cleared. Every old answer stays exactly where it is,
-- so this migration is undone by setting the two new columns back to null and
-- nothing is lost in between. `updated_at` is not touched either: the record did
-- not change, only the shelf it is filed on.

UPDATE complaints c
   SET complaint_category    = m.category,
       complaint_subcategory = COALESCE(
         m.subcategory,
         CASE WHEN m.category = 'Damage' AND c.part_type = 'Rubber parts'
              THEN 'Rubber Part' END)
  FROM (VALUES
         ('Wrong supply',                            'Supply Related', 'Wrong'),
         ('Short supply',                            'Supply Related', 'Short'),
         ('Excess supply',                           'Supply Related', 'Excess'),
         ('Supply related (short / wrong / excess)', 'Supply Related', NULL::text),
         ('Damage',                                  'Damage',         NULL::text),
         ('Client issue',                            'Client Related', NULL::text),
         ('Capacity issue',                          'Performance',    'Capacity'),
         ('Gearbox',                                 'BOI Issue',      NULL::text),
         ('Motor',                                   'BOI Issue',      NULL::text)
       ) AS m(defect_category, category, subcategory)
 WHERE c.defect_category = m.defect_category
   AND c.complaint_category IS NULL;
