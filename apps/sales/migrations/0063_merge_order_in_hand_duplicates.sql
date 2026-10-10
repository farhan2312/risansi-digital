-- Merge the remaining order-in-hand duplicates into their quotation record.
--
-- Migration 0052 did this for 106 pairs. These are 61 it did not reach, found
-- when a rep spotted two Won rows for AHMEDNAGAR STEELS with no quotation
-- against them. Same defect, same fix, and a stronger match rule than 0052's
-- tiers used:
--
--   the order-in-hand opportunity and the quotation opportunity are on the same
--   client and carry THE SAME SALES ORDER — same number and the same value to
--   the rupee.
--
-- That is not a similarity heuristic. It is the same sales order recorded twice,
-- once by the June-2026 order register (auto_source='order-in-hand-jun26', no
-- quote ref) and once by the FY26-27 quote list. Every one of the 61 maps to
-- exactly one quotation record, and none maps to a survivor another pair claims.
--
-- The duplicates carry nothing else. No line items, no remarks, no quotation
-- documents, no offer revisions, no stage history, no purchase orders — checked
-- across all 61 before this was written. They hold their sales order and their
-- row in the order register, and both of those move to the survivor.
--
-- WHAT MOVES, AND THE ONE THING THAT MUST NOT BE LOST
--
-- The order register row is the money: ₹1,54,06,435 across the 61. Its FK is
-- ON DELETE NO ACTION, so step 5 fails outright unless step 2 has re-pointed it
-- first — which is the correct way round, because a cascade here would have
-- silently deleted the order instead.
--
-- The sales order does NOT move. Every survivor already holds that SO number
-- (it is how they were matched), and the survivor's copy is the better one: the
-- imported copy has no so_date, the quotation copy does. The guard in step 3
-- therefore skips all 61 and the imported row goes with the cascade.
--
-- final_value_cr is taken from the imported record, following 0052's rule that
-- value_cr is what we quoted and final_value_cr is what the order actually
-- booked at. On 47 pairs the two already agree. On the other 14 the survivor's
-- final_value_cr is merely a copy of its own quoted value while the imported
-- record carries the real booked figure — so those 14 survivors currently
-- contradict their own sales order, and this makes them consistent.
--
-- Reversal: every deleted row is archived whole as jsonb in
-- opportunities_merge_archive with the id it was merged into, exactly as 0052
-- did. Restoring a pair means re-inserting the row and moving
-- orders.opportunity_id back from merged_into_id to the restored id.

CREATE TEMP TABLE merge_pairs_0063 (
  oih_id  integer PRIMARY KEY,
  twin_id integer NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO merge_pairs_0063 (oih_id, twin_id) VALUES
  (3389, 4911),     -- SATA01N047 · SO26/1/559 · ₹7,22,320
  (3397, 5150),     -- SATA01N047 · SO26/1/807 · ₹4,71,947
  (3404, 4910),     -- KUTC01S409 · SO26/1/560 · ₹3,64,500
  (3412, 5048),     -- KOLA01V005 · SO26/1/709 · ₹2,64,614
  (3418, 5208),     -- AHMD01A306 · SO26/1/889 · ₹2,41,980
  (3421, 5151),     -- AHMD01A306 · SO26/1/779 · ₹2,37,400
  (3426, 4916),     -- BAGL01E023 · SO26/1/898 · ₹2,17,703
  (3428, 5040),     -- SATA01N047 · SO26/1/686 · ₹2,05,327
  (3436, 5023),     -- BEED01J092 · SO26/1/782 · ₹1,74,000
  (3443, 5069),     -- ARGB01B051 · SO26/1/672 · ₹1,48,728
  (3450, 5068),     -- KUTC01S409 · SO26/1/657 · ₹1,32,300
  (3468, 5062),     -- SANG01R002 · SO26/1/695 · ₹91,468
  (3488, 5083),     -- PUNE01D004 · SO26/1/821 · ₹55,250
  (3490, 5156),     -- KUTC01S409 · SO26/1/819 · ₹51,510
  (3495, 5121),     -- NANE01K040 · SO26/1/743 · ₹31,960
  (3507, 4918),     -- BAGL01J007 · SO26/1/611 · ₹9,500
  (3513, 5047),     -- SANG01U007 · SO26/1/796 · ₹4,00,000
  (3514, 5044),     -- KOLH01S032 · SO26/1/829 · ₹3,83,155
  (3516, 5021),     -- DUGG01S021 · SO26/1/823 · ₹3,49,800
  (3518, 5052),     -- BELG01I054 · SO26/1/866 · ₹2,52,315
  (3520, 5053),     -- BELG01I054 · SO26/1/864 · ₹2,40,205
  (3526, 4964),     -- SANG01S603 · SO26/1/570 · ₹1,70,000
  (3529, 5001),     -- KOLH01S293 · SO26/1/785 · ₹1,04,200
  (3530, 5234),     -- ATHA01S614 · SO26/1/978 · ₹97,441
  (3531, 4999),     -- SANG01K021 · SO26/1/704 · ₹95,811
  (3567, 4944),     -- KANC01B064 · SO26/1/668 · ₹3,87,714
  (3574, 5113),     -- KOLH01S203 · SO26/1/808 · ₹3,41,124
  (3604, 5130),     -- VISH01A155 · SO26/1/715 · ₹1,96,000
  (3606, 5058),     -- KHUR01T078 · SO26/1/787 · ₹1,92,000
  (3618, 5201),     -- KANC01M005 · SO26/1/920 · ₹1,62,799
  (3637, 5020),     -- THAN01V118 · SO26/1/767 · ₹1,25,000
  (3638, 5216),     -- SITM01R015 · SO26/1/929 · ₹1,24,384
  (3640, 4951),     -- KANC01B064 · SO26/1/836 · ₹1,20,000
  (3641, 5161),     -- DLHI01D018 · SO26/1/791 · ₹1,18,000
  (3648, 5197),     -- VISH01A155 · SO26/1/872 · ₹1,08,000
  (3654, 5160),     -- MUMB01F064 · SO26/1/970 · ₹98,750
  (3655, 5111),     -- BIJN01P001 · SO26/1/750 · ₹96,600
  (3660, 5127),     -- WSCH01M066 · SO26/1/896 · ₹92,000
  (3674, 4948),     -- RAMP01T075 · SO26/1/555 · ₹74,401
  (3678, 5105),     -- KANP01N189 · SO26/1/816 · ₹70,000
  (3687, 5212),     -- HYDE01S316 · SO26/1/913 · ₹65,000
  (3698, 5013),     -- GUJA01T225 · SO26/1/799 · ₹59,332
  (3699, 4957),     -- DLHI01D018 · SO26/1/546 · ₹59,000
  (3700, 5152),     -- DLHI01D018 · SO26/1/790 · ₹59,000
  (3715, 4928),     -- BAGH01R045 · SO26/1/514 · ₹43,016
  (3734, 5233),     -- JANA01H031 · SO26/1/973 · ₹32,088
  (3739, 5174),     -- BELG01G012 · SO26/1/811 · ₹28,028
  (3740, 5039),     -- SHAM01M170 · SO26/1/652 · ₹28,000
  (3744, 5114),     -- MOHA01E007 · SO26/1/798 · ₹26,340
  (3758, 5134),     -- GUJA01I079 · SO26/1/713 · ₹21,432
  (3796, 4908),     -- RANI01A298 · SO26/1/542 · ₹2,10,250
  (3817, 5189),     -- CHEN01K138 · SO26/1/902 · ₹56,000
  (3824, 4931),     -- TIRU01B024 · SO26/1/544 · ₹25,488
  (3840, 5077),     -- SATA01K008 · SO26/1/789 · ₹1,40,000
  (3842, 5086),     -- SURA01G134 · SO26/1/667 · ₹24,250
  (3848, 4906),     -- PUNE01W021 · SO26/1/800 · ₹62,39,754
  (3870, 4915),     -- NANA01C030 · SO26/1/503 · ₹1,75,926
  (3876, 5104),     -- PUNE01W021 · SO26/1/786 · ₹96,000
  (3877, 4922),     -- PUNE01A106 · SO26/1/535 · ₹90,000
  (3878, 5202),     -- PUNE01W021 · SO26/1/965 · ₹90,000
  (3890, 4983);     -- NAGP01N185 · SO26/1/607 · ₹17,325

-- Refuse to run against anything that has moved since the set was derived.
-- A silent partial merge would be far worse than a failed migration.
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM merge_pairs_0063 m
   WHERE NOT EXISTS (SELECT 1 FROM opportunities o
                      WHERE o.id = m.oih_id
                        AND o.auto_source = 'order-in-hand-jun26'
                        AND o.quote_ref IS NULL)
      OR NOT EXISTS (SELECT 1 FROM opportunities t
                      WHERE t.id = m.twin_id AND t.quote_ref IS NOT NULL);
  IF bad > 0 THEN
    RAISE EXCEPTION 'merge 0063: % pair(s) no longer match the shape they were derived from', bad;
  END IF;
END $$;

-- 1. Carry the booked value, the Won stage and the provenance onto the survivor.
--    value_cr is deliberately left alone: it is the quoted figure and stays.
UPDATE opportunities t
   SET final_value_cr = o.final_value_cr,
       stage          = 'Won',
       notes          = NULLIF(TRIM(BOTH E'\n' FROM
                          COALESCE(t.notes, '') || E'\n' ||
                          'Merged from order-in-hand record #' || o.id ||
                          COALESCE(' · SO ' || ord.po_number, '')), ''),
       updated_at     = NOW()
  FROM merge_pairs_0063 m
  JOIN opportunities o ON o.id = m.oih_id
  LEFT JOIN orders ord ON ord.opportunity_id = o.id
 WHERE t.id = m.twin_id;

-- 2. Re-point the order register. MUST run before step 5: the FK is
--    ON DELETE NO ACTION, so the delete fails while these rows still point here.
UPDATE orders ord SET opportunity_id = m.twin_id
  FROM merge_pairs_0063 m WHERE ord.opportunity_id = m.oih_id;

-- 3. Re-point the sales order only where the survivor does not already hold it.
--    For all 61 it does, so nothing moves and the imported copy — the one with
--    no so_date — is dropped by the cascade in step 5. The clause stays because
--    it is what makes that safe rather than accidental.
UPDATE opportunity_sales_orders s SET opportunity_id = m.twin_id
  FROM merge_pairs_0063 m
 WHERE s.opportunity_id = m.oih_id
   AND NOT EXISTS (SELECT 1 FROM opportunity_sales_orders k
                    WHERE k.opportunity_id = m.twin_id AND k.so_number = s.so_number);

-- 4. Archive the whole row before it goes.
INSERT INTO opportunities_merge_archive (merged_into_id, tier, opportunity_id, row_data)
SELECT m.twin_id, 'SO', o.id, to_jsonb(o)
  FROM merge_pairs_0063 m JOIN opportunities o ON o.id = m.oih_id;

-- 5. Retire the duplicate.
DELETE FROM opportunities o USING merge_pairs_0063 m WHERE o.id = m.oih_id;

-- Nothing may be left behind, and no order may have gone missing.
DO $$
DECLARE leftover integer; orphaned integer;
BEGIN
  SELECT count(*) INTO leftover FROM opportunities o
    JOIN merge_pairs_0063 m ON m.oih_id = o.id;
  SELECT count(*) INTO orphaned FROM orders WHERE opportunity_id IS NULL;
  IF leftover > 0 THEN RAISE EXCEPTION 'merge 0063: % duplicate(s) survived the delete', leftover; END IF;
  IF orphaned > 0 THEN RAISE EXCEPTION 'merge 0063: % order(s) left with no opportunity', orphaned; END IF;
END $$;
