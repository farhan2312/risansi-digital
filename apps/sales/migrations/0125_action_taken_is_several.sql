-- "Action taken" on a complaint can be more than one thing.
--
-- A complaint is often answered in several ways at once — a free replacement
-- AND a site visit, or technical support while a replacement is arranged —
-- and the single column forced whoever typed it to pick the one that looked
-- most important and lose the rest.
--
-- Modelled on capa_departments, which is already a text[] with a working
-- multi-select on the form, rather than inventing a second pattern.
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS action_categories text[];

-- Carry across what is already recorded. 46 complaints hold a single action
-- today; each becomes a one-element list.
UPDATE complaints
   SET action_categories = ARRAY[action_category]
 WHERE action_category IS NOT NULL AND btrim(action_category) <> ''
   AND action_categories IS NULL;

-- action_category stays, holding the FIRST of the chosen actions.
--
-- Not dead weight and not duplication for its own sake: the complaints list
-- column, the dashboard filter, the lookup usage counts on Admin › Complaint
-- Settings and the stage guard that refuses "Replacement Pending" without a
-- replacement all read it. Keeping it in step means none of them has to
-- learn about arrays on the same day the form does, and a reader who sorts
-- the list by Action taken still gets a sensible order.
--
-- The save path writes both. If the two ever disagree, action_categories is
-- the truth.
COMMENT ON COLUMN complaints.action_category IS
  'The first of complaints.action_categories, kept in step for the list, the filters and the stage rules. action_categories is the source of truth.';

CREATE INDEX IF NOT EXISTS idx_complaints_action_categories
  ON complaints USING GIN (action_categories);
