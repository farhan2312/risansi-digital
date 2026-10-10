-- Nine answers the rebuilt pages need somewhere to put.
--
-- 1. Model Series. The name plate model is whatever is stamped on the pump and
--    is typed as it reads; the series (H10 through H120L) is the handle the
--    dashboard sorts and filters on ("H100 and above"). Free text on purpose —
--    the series list is still growing and a closed list would send users back
--    to typing the model into the wrong field.
--
-- 2. Cost Impact. A commercial flag: did answering this complaint cost us
--    money. It is set from the action taken (Free Replacement and Replace
--    Material force it true) and by any FR anywhere in the flow. This is NOT
--    `risk_cost_impact`, which is one of the eleven severity questions on page
--    3 and is left alone.
--
-- 3. The complaint this one repeats. A repeat was a yes/no with no way to say
--    what it repeated, so the connection lived in someone's memory. The new
--    occurrence is logged in full and linked back to the original rather than
--    being refused as a duplicate.
--
-- 4. CAPA departments. QC and Purchase can both own a CAPA on the same
--    complaint, so this is an array and not a single owner; the old single
--    `responsible_department` could not say "both".
--
-- 5-6. Corrective and preventive action in words. The page recorded that
--    action was required and, separately, a preventive action; what was
--    actually done and what will stop it recurring had nowhere to go.
--
-- 7-10. The FR challan split. `challan_value` was one number covering freight
--    and material together, which cannot be reconciled against the challan.
--    Transportation and material are now asked separately, each as a yes/no
--    with its own value, so a zero and a not-applicable are different answers.

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS model_series              text,
  ADD COLUMN IF NOT EXISTS cost_impact               boolean,
  ADD COLUMN IF NOT EXISTS linked_complaint_id       integer REFERENCES complaints(id),
  ADD COLUMN IF NOT EXISTS capa_departments          text[],
  ADD COLUMN IF NOT EXISTS corrective_action_remarks text,
  ADD COLUMN IF NOT EXISTS preventive_action_remarks text,
  ADD COLUMN IF NOT EXISTS fr_transport_applicable   boolean,
  ADD COLUMN IF NOT EXISTS fr_transport_value        numeric(14,2),
  ADD COLUMN IF NOT EXISTS fr_material_applicable    boolean,
  ADD COLUMN IF NOT EXISTS fr_material_value         numeric(14,2);

COMMENT ON COLUMN complaints.model_series IS
  'The internal series the pump belongs to, H10 to H120L. Free text. What the dashboard sorts and filters by rating on; pump_model holds the name plate reading.';
COMMENT ON COLUMN complaints.cost_impact IS
  'Whether answering this complaint cost us money. Forced true by a Free Replacement or Replace Material action, and by any FR raised anywhere in the flow. Not risk_cost_impact, which is a severity question.';
COMMENT ON COLUMN complaints.linked_complaint_id IS
  'The earlier complaint this one repeats. Set when repeat_complaint is true, so a repeat is logged in full and linked rather than refused as a duplicate.';
COMMENT ON COLUMN complaints.capa_departments IS
  'Every department a CAPA is owed from — QC and Purchase can both be on the hook for one complaint, so this is a list and not a single owner.';
COMMENT ON COLUMN complaints.corrective_action_remarks IS
  'What was actually done to answer this complaint, in words.';
COMMENT ON COLUMN complaints.preventive_action_remarks IS
  'What will stop it happening again, in words. The SOP the Quality team drafts from this is a separate feature.';
COMMENT ON COLUMN complaints.fr_transport_applicable IS
  'Whether the free replacement carried a transport cost. Kept apart from the value so nil and not-applicable are different answers.';
COMMENT ON COLUMN complaints.fr_transport_value IS
  'The transport cost of the free replacement, as on the challan.';
COMMENT ON COLUMN complaints.fr_material_applicable IS
  'Whether the free replacement carried a material cost.';
COMMENT ON COLUMN complaints.fr_material_value IS
  'The material cost of the free replacement, as on the challan.';

-- A complaint cannot repeat itself.
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_linked_complaint_not_self;
ALTER TABLE complaints ADD CONSTRAINT complaints_linked_complaint_not_self
  CHECK (linked_complaint_id IS NULL OR linked_complaint_id <> id);

CREATE INDEX IF NOT EXISTS complaints_linked_complaint_idx
  ON complaints (linked_complaint_id) WHERE linked_complaint_id IS NOT NULL;
