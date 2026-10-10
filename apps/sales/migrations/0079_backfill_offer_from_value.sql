-- 0079: put the Total Offer back where the stage-move form lost it.
--
-- From 26 Aug the move to Quoted (and the edit drawer) saved through
-- updateOpportunity, which wrote value_cr from the Total Offer but never
-- offer_value_inr, market, enquiry no/date or the line items. The rupee
-- amount therefore survived, in crores, on every affected row; this writes
-- it back. Market and the line items typed into those forms were never
-- stored and cannot be recovered — they have to be entered again.

UPDATE opportunities
   SET offer_value_inr = round(value_cr * 10000000),
       updated_at = now()
 WHERE stage IN ('Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost')
   AND offer_value_inr IS NULL
   AND value_cr > 0;
