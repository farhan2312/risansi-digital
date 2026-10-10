-- Retire five opportunity columns the app no longer reads.
--
-- The code that referenced them went out in the previous deploy. This runs only
-- after that deploy is live: drop a column while the running build still selects
-- it and every request touching that query fails for the length of the rollout.
--
-- WHAT IS BEING DROPPED, AND WHY EACH ONE IS SAFE
--
--   equipment_id         0 of 1811 rows. Written once, in the displacement path,
--                        and never read back.
--   expected_close_date  0 of 1811 rows, and not because nobody wanted it. A
--                        fallback INSERT was putting eta_text — a month string
--                        like "Mar 2026" — into a date column, so the cast threw
--                        every time. eta_text holds that shape and survives.
--   secondary_rep_id     1 of 1811 rows, and on that row it equals rep_id, so it
--                        records nothing the primary rep does not already say.
--   offer_value_usd      79 of 1811 opportunities, 124 of 963 line items. These
--                        are not hand-typed figures: every one divides its rupee
--                        value by a conversion rate (80 on the bulk of them, 92
--                        and 90 on the rest, with a few slips at 160 and 800 that
--                        are a doubled or shifted 80). USD is derived from the
--                        settings rate for display and has been for a while, so
--                        the column carries no information its rupee twin lacks.
--   revised_offer_value_usd  6 rows, same story, same rates.
--
-- The USD figures are archived below regardless. A dropped column does not come
-- back, and the archive costs one small table.

-- ── 1. Two line items would lose real data, so fix them first ──────────────
--
-- Two of the 124 USD line items have no rupee value at all, so for those two the
-- USD column is the only record of the amount. Both are the sole line item on
-- their opportunity and both reconcile exactly against the opportunity total,
-- which makes the rupee figure recoverable rather than guessed:
--
--   item 1254 (opp 5405): usd 496350 = opp offer_value_inr 496350 exactly.
--                         The parser filed a rupee figure in the USD column.
--   item 1437 (opp 5586): usd 11951 x 80 = opp offer_value_inr 956080 exactly.
--
-- Anything less exact than this would be left alone rather than back-filled.
UPDATE opportunity_items i
   SET offer_value_inr = o.offer_value_inr
  FROM opportunities o
 WHERE o.id = i.opportunity_id
   AND i.offer_value_inr IS NULL
   AND i.offer_value_usd IS NOT NULL
   AND o.offer_value_inr IS NOT NULL
   -- sole line item on the opportunity
   AND (SELECT count(*) FROM opportunity_items x WHERE x.opportunity_id = o.id) = 1
   -- and reconciles exactly, either 1:1 or at a whole-number rate
   AND (o.offer_value_inr = i.offer_value_usd
        OR (i.offer_value_usd <> 0
            AND o.offer_value_inr::numeric / i.offer_value_usd::numeric
                = round(o.offer_value_inr::numeric / i.offer_value_usd::numeric)));

-- ── 2. Archive the USD figures before they go ─────────────────────────────
CREATE TABLE IF NOT EXISTS retired_columns_0062 (
  source_table text   NOT NULL,
  row_id       bigint NOT NULL,
  values       jsonb  NOT NULL,
  archived_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, row_id)
);

COMMENT ON TABLE retired_columns_0062 IS
  'Values from the columns migration 0062 dropped. Kept because a drop is not '
  'reversible; every figure here is derivable from its rupee twin, so this is '
  'insurance rather than a data source. Safe to delete once 0062 has settled.';

INSERT INTO retired_columns_0062 (source_table, row_id, values)
SELECT 'opportunities', id,
       jsonb_strip_nulls(jsonb_build_object(
         'offer_value_usd',         offer_value_usd,
         'revised_offer_value_usd', revised_offer_value_usd,
         'secondary_rep_id',        secondary_rep_id))
  FROM opportunities
 WHERE offer_value_usd IS NOT NULL
    OR revised_offer_value_usd IS NOT NULL
    OR secondary_rep_id IS NOT NULL
ON CONFLICT (source_table, row_id) DO NOTHING;

INSERT INTO retired_columns_0062 (source_table, row_id, values)
SELECT 'opportunity_items', id,
       jsonb_build_object('offer_value_usd', offer_value_usd)
  FROM opportunity_items
 WHERE offer_value_usd IS NOT NULL
ON CONFLICT (source_table, row_id) DO NOTHING;

-- ── 3. Drop ────────────────────────────────────────────────────────────────
ALTER TABLE opportunities
  DROP COLUMN IF EXISTS equipment_id,
  DROP COLUMN IF EXISTS expected_close_date,
  DROP COLUMN IF EXISTS secondary_rep_id,
  DROP COLUMN IF EXISTS offer_value_usd,
  DROP COLUMN IF EXISTS revised_offer_value_usd;

ALTER TABLE opportunity_items
  DROP COLUMN IF EXISTS offer_value_usd;

-- NOT DROPPED, though the audit sheet listed them:
--
--   revised_offer_value_inr / revised_offer_date — these are a live denormalised
--   copy of the newest row in opportunity_offer_revisions (42 and 46 rows),
--   maintained by syncOfferRevisions so the stage dashboard and both exports can
--   read one column instead of joining. Retiring them is a rewrite of every
--   reader, not a column drop.
--
--   tsm_user_id / tsm_external / tsm_external_email / tsm_notified_at — the
--   visit report has a working TSM picker behind these, internal user or
--   external person with an email, and the visit action writes it. Two rows have
--   used it. That is an unused feature, which is a product decision, not a dead
--   column.
