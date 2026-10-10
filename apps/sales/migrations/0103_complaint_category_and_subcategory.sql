-- The question a complaint is filed under, and the one underneath it.
--
-- `defect_category` grew by accretion: thirteen values that mix a symptom
-- (Leakage, Capacity issue), a part (Gearbox, Motor) and a fault (Supply
-- related) on one list, so nothing counts cleanly and the list cannot route
-- work. The Complaint Team's answer is five categories with a sub-category
-- under each, and routing follows the category: Performance, BOI Issue and
-- Damage go to QC, Supply Related and Client Related to the Complaint Team.
--
-- Both new columns sit beside `defect_category`, which is kept and left alone.
-- The 219 complaints on file were filed against the old list and their answers
-- stay readable; migration 0113 copies across only the ones that map without a
-- guess, and because the old column is untouched that copy can be undone.

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS complaint_category    text,
  ADD COLUMN IF NOT EXISTS complaint_subcategory text;

COMMENT ON COLUMN complaints.complaint_category IS
  'What kind of complaint this is: Supply Related, BOI Issue, Performance, Damage, Client Related. Decides whether it is QC''s or the Complaint Team''s to answer. Replaces defect_category, which is kept for the records filed against it.';
COMMENT ON COLUMN complaints.complaint_subcategory IS
  'The sub-category under complaint_category — the complaint_subcategory lookup, filtered by parent_value = the category. Left empty where the old record did not say enough to choose one.';

CREATE INDEX IF NOT EXISTS complaints_complaint_category_idx
  ON complaints (complaint_category) WHERE complaint_category IS NOT NULL;
