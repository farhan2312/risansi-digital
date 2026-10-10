-- Pumps are entered as a batch now.
--
-- A plant orders six identical pumps: one model, one liquid, one capacity, one
-- head — and six serial numbers, six SO numbers, six EC numbers. The form used
-- to ask for all seven fields once, so a rep entering six pumps re-typed the
-- four shared attributes six times, and nothing recorded that the six belonged
-- together. It now asks for the shared four, then a quantity, then three boxes
-- per pump.
--
-- batch_id is what makes such a group re-editable as a group. Rows created in
-- one go share it, so reopening the record shows all six pumps rather than one.
--
-- Existing rows keep batch_id NULL, which reads as "a batch of one" — every one
-- of the 5,985 rows on file already has quantity = 1, so nothing is being
-- reinterpreted. They start behaving as batches the first time someone saves
-- them through the new form.
--
-- Deliberately NOT backfilled by grouping on (client, model, liquid, capacity,
-- head): 1,081 such clusters exist in the data, but only 318 share an SO number,
-- so they are mostly separate orders that happen to be the same pump. Inventing
-- batches out of them would merge unrelated purchases.

ALTER TABLE client_pumps
  ADD COLUMN IF NOT EXISTS batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_client_pumps_batch
  ON client_pumps (batch_id) WHERE batch_id IS NOT NULL;
