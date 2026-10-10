-- The pipeline value follows the latest revised offer.
--
-- A quote re-priced from 10,00,000 down to 8,50,000 was still forecasting at
-- 10,00,000: revisions were recorded (migration 0041) but nothing fed them back
-- into opportunities.value_cr, which is what every KPI, bracket and forecast
-- reads. The newest revision is the current price, so it should be the value.
--
-- syncOfferRevisions now maintains this going forward. This backfills the 42
-- opportunities that already carry a revision.
--
-- No data is lost by doing so. The original offer stays in offer_value_inr and
-- every intermediate price stays in opportunity_offer_revisions, so the full
-- history is still readable — only the single derived figure moves.
--
-- final_value_cr is deliberately untouched. On a Won deal that is the amount
-- actually booked, which is a different fact from what the quotation currently
-- says; the Won totals COALESCE to it first and so are unaffected.

UPDATE opportunities o
   SET value_cr   = r.value_inr / 10000000.0,
       updated_at = NOW()
  FROM (
    SELECT DISTINCT ON (opportunity_id) opportunity_id, value_inr
      FROM opportunity_offer_revisions
     ORDER BY opportunity_id, revised_on DESC, id DESC
  ) r
 WHERE r.opportunity_id = o.id
   AND o.value_cr IS DISTINCT FROM (r.value_inr / 10000000.0);
