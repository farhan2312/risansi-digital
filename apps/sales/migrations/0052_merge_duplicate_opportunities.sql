-- Merge the order-in-hand duplicates into their quotation record.
--
-- Two data loads created the same deal twice: the June-2026 order-in-hand
-- register (auto_source='order-in-hand-jun26') and the FY26-27 quote list. The
-- quotation row is the richer record (quote ref, quote date, market, location,
-- RIL rep, project, pump model) and survives; the order row contributes the
-- sales order, order date, confirmed value and dispatch status, then is retired.
--
-- The 106 pairs are listed explicitly rather than re-derived, so this applies
-- exactly the set signed off in the review sheet:
--   Tier A (35) — order value equals the quote value to the rupee, same client.
--                 Independently corroborated: in all 35 the quote predates the
--                 order (1-101 days) and the product categories agree.
--   Tier B (71) — same client and product category, quote 0-180 days before the
--                 order, order booked at a round percentage discount off the
--                 quote, and a clean 1:1 match on both sides.
--
-- Reversal: every deleted row is archived whole as jsonb in
-- opportunities_merge_archive together with the id it was merged into, so a pair
-- can be reconstructed. Re-pointing back is a matter of moving orders.opportunity_id
-- and opportunity_sales_orders.opportunity_id from merged_into_id to the restored id.

CREATE TABLE IF NOT EXISTS opportunities_merge_archive (
  id             serial PRIMARY KEY,
  archived_at    timestamptz NOT NULL DEFAULT NOW(),
  merged_into_id integer     NOT NULL,
  tier           text        NOT NULL,
  opportunity_id integer     NOT NULL,
  row_data       jsonb       NOT NULL
);

CREATE TEMP TABLE merge_pairs (oih_id integer PRIMARY KEY, twin_id integer NOT NULL UNIQUE, tier text NOT NULL) ON COMMIT DROP;

INSERT INTO merge_pairs (oih_id, twin_id, tier) VALUES
  (3405, 4985, 'A'),
  (3408, 5145, 'A'),
  (3414, 4938, 'A'),
  (3427, 5010, 'A'),
  (3439, 5015, 'A'),
  (3459, 5109, 'A'),
  (3473, 4996, 'A'),
  (3478, 4943, 'A'),
  (3482, 5009, 'A'),
  (3494, 4968, 'A'),
  (3496, 5172, 'A'),
  (3501, 5119, 'A'),
  (3527, 4955, 'A'),
  (3540, 5180, 'A'),
  (3549, 5090, 'A'),
  (3551, 4982, 'A'),
  (3647, 4967, 'A'),
  (3666, 547, 'A'),
  (3670, 5204, 'A'),
  (3672, 4909, 'A'),
  (3693, 5221, 'A'),
  (3696, 4979, 'A'),
  (3725, 4930, 'A'),
  (3726, 4934, 'A'),
  (3741, 4937, 'A'),
  (3750, 4978, 'A'),
  (3762, 4992, 'A'),
  (3780, 5235, 'A'),
  (3813, 4925, 'A'),
  (3828, 5482, 'A'),
  (3830, 5483, 'A'),
  (3836, 5125, 'A'),
  (3837, 5481, 'A'),
  (3845, 5213, 'A'),
  (3881, 4947, 'A'),
  (3386, 5026, 'B'),
  (3394, 5139, 'B'),
  (3433, 4993, 'B'),
  (3434, 4987, 'B'),
  (3440, 5196, 'B'),
  (3441, 5117, 'B'),
  (3442, 5060, 'B'),
  (3444, 5159, 'B'),
  (3445, 5148, 'B'),
  (3446, 4966, 'B'),
  (3447, 5080, 'B'),
  (3452, 5168, 'B'),
  (3456, 5011, 'B'),
  (3461, 5012, 'B'),
  (3471, 5071, 'B'),
  (3472, 5170, 'B'),
  (3481, 5006, 'B'),
  (3486, 5078, 'B'),
  (3487, 4926, 'B'),
  (3493, 5030, 'B'),
  (3519, 4963, 'B'),
  (3522, 4941, 'B'),
  (3523, 5065, 'B'),
  (3525, 5135, 'B'),
  (3528, 5054, 'B'),
  (3532, 5203, 'B'),
  (3533, 5055, 'B'),
  (3536, 5181, 'B'),
  (3560, 4998, 'B'),
  (3578, 4980, 'B'),
  (3581, 5214, 'B'),
  (3593, 5025, 'B'),
  (3596, 5209, 'B'),
  (3597, 5207, 'B'),
  (3599, 5112, 'B'),
  (3603, 5118, 'B'),
  (3605, 5157, 'B'),
  (3614, 4995, 'B'),
  (3621, 5032, 'B'),
  (3622, 5186, 'B'),
  (3633, 5123, 'B'),
  (3658, 5169, 'B'),
  (3676, 5222, 'B'),
  (3680, 5081, 'B'),
  (3683, 5138, 'B'),
  (3685, 5115, 'B'),
  (3691, 5034, 'B'),
  (3695, 5096, 'B'),
  (3710, 5124, 'B'),
  (3716, 5037, 'B'),
  (3717, 5178, 'B'),
  (3723, 5070, 'B'),
  (3728, 5017, 'B'),
  (3733, 4988, 'B'),
  (3746, 5173, 'B'),
  (3747, 4933, 'B'),
  (3759, 5129, 'B'),
  (3763, 5046, 'B'),
  (3765, 5043, 'B'),
  (3769, 5177, 'B'),
  (3775, 5182, 'B'),
  (3787, 5095, 'B'),
  (3795, 4949, 'B'),
  (3801, 4965, 'B'),
  (3811, 4927, 'B'),
  (3820, 5061, 'B'),
  (3833, 5162, 'B'),
  (3859, 5019, 'B'),
  (3862, 4977, 'B'),
  (3879, 4970, 'B'),
  (3883, 4962, 'B');

-- Guard: refuse to run unless every pair is still the shape we validated —
-- the victim is an order-in-hand row, the survivor is not, and both still exist.
DO $$
DECLARE bad integer;
BEGIN
  SELECT COUNT(*) INTO bad FROM merge_pairs m
   WHERE NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.id = m.oih_id  AND o.auto_source = 'order-in-hand-jun26')
      OR NOT EXISTS (SELECT 1 FROM opportunities t WHERE t.id = m.twin_id AND COALESCE(t.auto_source,'x') <> 'order-in-hand-jun26');
  IF bad > 0 THEN
    RAISE EXCEPTION 'merge aborted: % pair(s) no longer match the validated shape', bad;
  END IF;
END $$;

-- 1. Carry the confirmed order value, dispatch status and provenance onto the
--    survivor. value_cr is deliberately left alone: it is what we QUOTED, while
--    final_value_cr is what the order actually booked at. For Tier B those differ
--    by the negotiated discount, and both are worth keeping.
UPDATE opportunities t
   SET final_value_cr = o.final_value_cr,
       stage          = 'Won',
       notes          = NULLIF(TRIM(BOTH E'\n' FROM
                          COALESCE(t.notes, '') || E'\n' ||
                          'Merged from order-in-hand record #' || o.id ||
                          COALESCE(' · SO ' || ord.po_number, '') ||
                          COALESCE(' · ' || NULLIF(SPLIT_PART(o.notes, '· ', 2), ''), '')), ''),
       updated_at     = NOW()
  FROM merge_pairs m
  JOIN opportunities o ON o.id = m.oih_id
  LEFT JOIN orders ord ON ord.opportunity_id = o.id
 WHERE t.id = m.twin_id;

-- 2. Re-point the order register. This FK is ON DELETE NO ACTION, so the delete
--    in step 5 fails outright unless this runs first.
UPDATE orders ord SET opportunity_id = m.twin_id
  FROM merge_pairs m WHERE ord.opportunity_id = m.oih_id;

-- 3. Re-point the sales order. This FK is ON DELETE CASCADE, so without this the
--    SO would be silently destroyed along with the row. Skipped where the survivor
--    already holds that SO (the three pairs a colleague merged by hand).
UPDATE opportunity_sales_orders s SET opportunity_id = m.twin_id
  FROM merge_pairs m
 WHERE s.opportunity_id = m.oih_id
   AND NOT EXISTS (SELECT 1 FROM opportunity_sales_orders k
                    WHERE k.opportunity_id = m.twin_id AND k.so_number = s.so_number);

-- 4. Archive the whole row before it goes.
INSERT INTO opportunities_merge_archive (merged_into_id, tier, opportunity_id, row_data)
SELECT m.twin_id, m.tier, o.id, to_jsonb(o) FROM merge_pairs m JOIN opportunities o ON o.id = m.oih_id;

-- 5. Retire the duplicate.
DELETE FROM opportunities o USING merge_pairs m WHERE o.id = m.oih_id;
