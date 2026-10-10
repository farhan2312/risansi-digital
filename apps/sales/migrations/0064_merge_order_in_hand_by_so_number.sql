-- Merge the order-in-hand duplicates that share a sales order NUMBER but not its value.
--
-- Migration 0052 merged 106 pairs, 0063 merged the 61 where the sales order matched
-- on number AND value to the rupee. These are the 62 left over: same client, same
-- sales order number, different value.
--
-- WHY THESE ARE THE SAME DEAL
--
-- The sales order number is the decisive fact. SO26/1/961 identifies one order;
-- two records carrying it for the same client are two records of that order, not
-- two orders. So the value gap answers a different question — which figure is
-- right — rather than whether the pair is a duplicate.
--
-- The spread supports it. On 56 of the 62 the order booked between 4% and 44%
-- below the quoted figure, median 17%, which is what a negotiated discount looks
-- like and is the same reasoning 0052's Tier B rested on. Each of the 62 maps to
-- exactly one quotation and no two claim the same survivor.
--
-- SIX PAIRS WHERE THE TWO SOURCES DISAGREE SHARPLY
--
-- These are merged like the rest, because the sales order number still says they
-- are one order, but the surviving VALUE is worth checking by hand afterwards:
--
--   3901 -> 4945  WEBU01B069  order ₹3,952       vs quote ₹3,78,285   (1%)
--   3821 -> 5131  GULB01N024  order ₹36,545      vs quote ₹12,88,524  (3%)
--   3403 -> 5074  LATU01T133  order ₹3,89,755    vs quote ₹12,17,237  (32%)
--   3470 -> 4994  SATA01J012  order ₹1,61,939    vs quote ₹4,67,250   (35%)
--   3722 -> 5195  MORA01L023  order ₹38,485      vs quote ₹36,132     (107%)
--   3598 -> 5022  DLHI01C018  order ₹2,66,850    vs quote ₹54,050     (494%)
--
-- A partial order against a larger quotation produces exactly the low ratios, and
-- an addition after quoting produces the high one, so none of these is evidence
-- against the merge. They are listed so the figures get a second look, not to
-- suggest the pairing is wrong.
--
-- WHAT MOVES
--
-- ₹1,15,29,112 of order-register value across the 62. That FK is
-- ON DELETE NO ACTION, so step 2 must re-point it before step 6 can delete
-- anything — the same ordering 0063 used, for the same reason.
--
-- Unlike 0063, the survivor's own sales-order row carries a DIFFERENT value from
-- the order register, so step 4 corrects it. Leaving it would hand the survivor a
-- final value from the order book and a sales order from the quote list that
-- disagree with each other — which is the inconsistency 0063 fixed on 14 of its
-- pairs, arriving here by a different route.
--
-- Reversible: every deleted row is archived whole as jsonb in
-- opportunities_merge_archive against the id it merged into, tier 'SO-NUM'.

CREATE TEMP TABLE merge_pairs_0064 (
  oih_id  integer PRIMARY KEY,
  twin_id integer NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO merge_pairs_0064 (oih_id, twin_id) VALUES
  (3609, 5126),     -- AMBA01O055 · SO26/1/868 · order ₹1,87,210 vs quote ₹1,99,160
  (3576, 4990),     -- AMRO01W025 · SO26/1/576 · order ₹3,36,331 vs quote ₹5,61,053
  (3718, 5067),     -- BADA01D033 · SO26/1/848 · order ₹40,950 vs quote ₹58,500
  (3392, 4932),     -- BAGL01J007 · SO26/1/552 · order ₹5,25,726 vs quote ₹5,84,140
  (3582, 5142),     -- BAHR01P006 · SO26/1/888 · order ₹2,94,505 vs quote ₹4,33,096
  (3624, 5103),     -- BALR01B044 · SO26/1/724 · order ₹1,52,877 vs quote ₹2,24,819
  (3465, 5128),     -- BEED01G069 · SO26/1/948 · order ₹98,573 vs quote ₹1,26,375
  (3489, 5210),     -- BEED01N030 · SO26/1/922 · order ₹51,935 vs quote ₹61,100
  (3724, 5200),     -- BETU01S230 · SO26/1/846 · order ₹38,010 vs quote ₹50,680
  (3646, 5230),     -- BETU01S230 · SO26/1/959 · order ₹1,10,938 vs quote ₹1,47,917
  (3642, 4913),     -- BIJN01B009 · SO26/1/673 · order ₹1,17,884 vs quote ₹2,10,508
  (3598, 5022),     -- DLHI01C018 · SO26/1/659 · order ₹2,66,850 vs quote ₹54,050   <-- value gap, flagged
  (3694, 5024),     -- FAIZ01K001 · SO26/1/676 · order ₹61,981 vs quote ₹75,045
  (3643, 5033),     -- GOND01B020 · SO26/1/619 · order ₹1,17,342 vs quote ₹1,72,562
  (3785, 4950),     -- GOND01M035 · SO26/1/623 · order ₹5,297 vs quote ₹7,790
  (3667, 5141),     -- GOPA01V011 · SO26/1/802 · order ₹83,509 vs quote ₹98,246
  (3821, 5131),     -- GULB01N024 · SO26/1/961 · order ₹36,545 vs quote ₹12,88,524   <-- value gap, flagged
  (3656, 5051),     -- GURD01C019 · SO26/1/835 · order ₹93,854 vs quote ₹1,38,021
  (3589, 5049),     -- HOSA01R037 · SO26/1/687 · order ₹2,48,339 vs quote ₹2,92,164
  (3591, 5094),     -- HOSH01I008 · SO26/1/842 · order ₹2,36,421 vs quote ₹3,63,725
  (3690, 5084),     -- INDR01A245 · SO26/1/708 · order ₹63,450 vs quote ₹70,500
  (3453, 5099),     -- JALN01K063 · SO26/1/820 · order ₹27,176 vs quote ₹30,195
  (3701, 5072),     -- JPNG01W005 · SO26/1/677 · order ₹58,200 vs quote ₹97,000
  (3731, 5035),     -- KANP01U025 · SO26/1/883 · order ₹33,480 vs quote ₹46,500
  (3602, 5226),     -- KANP01Y015 · SO26/1/968 · order ₹2,00,000 vs quote ₹2,20,000
  (3517, 5097),     -- KOLH01S105 · SO26/1/810 · order ₹3,08,359 vs quote ₹3,63,879
  (3791, 5029),     -- KRSH01K010 · SO26/1/731 · order ₹5,69,091 vs quote ₹6,11,926
  (3607, 5064),     -- KUSH01T074 · SO26/1/935 · order ₹2,44,125 vs quote ₹2,96,950
  (3650, 5004),     -- KUTC01S044 · SO26/1/590 · order ₹1,07,142 vs quote ₹1,15,830
  (3649, 5153),     -- KUTC01S044 · SO26/1/770 · order ₹1,07,143 vs quote ₹1,15,830
  (3563, 5042),     -- LAKM01Z003 · SO26/1/706 · order ₹4,17,816 vs quote ₹6,63,200
  (3409, 5079),     -- LATU01O034 · SO26/1/924 · order ₹2,78,540 vs quote ₹3,81,562
  (3403, 5074),     -- LATU01T133 · SO26/1/960 · order ₹3,89,755 vs quote ₹12,17,237   <-- value gap, flagged
  (3625, 5185),     -- MALA01W049 · SO26/1/879 · order ₹1,48,554 vs quote ₹2,47,590
  (3572, 5014),     -- MALE01V009 · SO26/1/665 · order ₹3,61,200 vs quote ₹4,51,500
  (3732, 5146),     -- MORA01D081 · SO26/1/788 · order ₹32,385 vs quote ₹46,264
  (3722, 5195),     -- MORA01L023 · SO26/1/861 · order ₹38,485 vs quote ₹36,132   <-- value gap, flagged
  (3797, 5073),     -- MYSR01B021 · SO26/1/698 · order ₹2,04,567 vs quote ₹2,47,960
  (3786, 4991),     -- NARS01A056 · SO26/1/599 · order ₹3,647 vs quote ₹4,290
  (3662, 5028),     -- NARS01S232 · SO26/1/616 · order ₹86,921 vs quote ₹1,02,260
  (3590, 5036),     -- PARB01Y004 · SO26/1/688 · order ₹1,90,271 vs quote ₹2,23,848
  (3708, 5087),     -- PARB01Y004 · SO26/1/714 · order ₹1,24,534 vs quote ₹1,46,510
  (3635, 5038),     -- PILI01N049 · SO26/1/642 · order ₹1,26,722 vs quote ₹1,50,860
  (3451, 5163),     -- PUNE01G122 · SO26/1/878 · order ₹1,32,216 vs quote ₹2,35,251
  (3543, 5829),     -- PUNE01R071 · SO26/1/587 · order ₹18,95,130 vs quote ₹22,36,253
  (3506, 5082),     -- PUNE01S278 · SO26/1/727 · order ₹10,180 vs quote ₹11,976
  (3611, 5041),     -- SAHA01B013 · SO26/1/756 · order ₹1,83,623 vs quote ₹3,27,898
  (3737, 5190),     -- SAHA01W004 · SO26/1/856 · order ₹28,800 vs quote ₹48,000
  (3470, 4994),     -- SATA01J012 · SO26/1/634 · order ₹1,61,939 vs quote ₹4,67,250   <-- value gap, flagged
  (3564, 5050),     -- SITP01A087 · SO26/1/739 · order ₹4,13,081 vs quote ₹6,40,404
  (3634, 5133),     -- SITP01D049 · SO26/1/741 · order ₹1,31,285 vs quote ₹2,01,977
  (3711, 5191),     -- SITP01D053 · SO26/1/860 · order ₹45,612 vs quote ₹70,172
  (3692, 4989),     -- SITP01T054 · SO26/1/735 · order ₹62,972 vs quote ₹74,085
  (3779, 5093),     -- SITP01T054 · SO26/1/745 · order ₹8,364 vs quote ₹9,840
  (3424, 5056),     -- SOLP01J034 · SO26/1/899 · order ₹2,50,629 vs quote ₹2,75,943
  (3484, 4917),     -- SOLP01J034 · SO26/1/962 · order ₹57,287 vs quote ₹67,396
  (3575, 4984),     -- SURA01S036 · SO26/1/766 · order ₹4,60,643 vs quote ₹5,54,991
  (3585, 5045),     -- SURA01S036 · SO26/1/768 · order ₹60,477 vs quote ₹72,864
  (3861, 4959),     -- UGAN01H043 · SO26/1/813 · order ₹3,75,820 vs quote ₹3,91,139
  (3784, 5231),     -- VAPI01G064 · SO26/1/955 · order ₹6,309 vs quote ₹6,641
  (3826, 4912),     -- VELL01T063 · SO26/1/670 · order ₹14,153 vs quote ₹15,300
  (3901, 4945);     -- WEBU01B069 · SO26/1/575 · order ₹3,952 vs quote ₹3,78,285   <-- value gap, flagged

-- Refuse to run if anything has moved since the set was derived.
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM merge_pairs_0064 m
   WHERE NOT EXISTS (SELECT 1 FROM opportunities o
                      WHERE o.id = m.oih_id
                        AND o.auto_source = 'order-in-hand-jun26'
                        AND o.quote_ref IS NULL)
      OR NOT EXISTS (SELECT 1 FROM opportunities t
                      WHERE t.id = m.twin_id AND t.quote_ref IS NOT NULL);
  IF bad > 0 THEN
    RAISE EXCEPTION 'merge 0064: % pair(s) no longer match the shape they were derived from', bad;
  END IF;
END $$;

-- 1. Carry the booked value, the Won stage and the provenance onto the survivor.
--    value_cr stays: it is the quoted figure and remains the quoted figure.
UPDATE opportunities t
   SET final_value_cr = o.final_value_cr,
       stage          = 'Won',
       notes          = NULLIF(TRIM(BOTH E'\n' FROM
                          COALESCE(t.notes, '') || E'\n' ||
                          'Merged from order-in-hand record #' || o.id ||
                          COALESCE(' · SO ' || ord.po_number, '')), ''),
       updated_at     = NOW()
  FROM merge_pairs_0064 m
  JOIN opportunities o ON o.id = m.oih_id
  LEFT JOIN orders ord ON ord.opportunity_id = o.id
 WHERE t.id = m.twin_id;

-- 2. Re-point the order register. MUST precede the delete: ON DELETE NO ACTION.
UPDATE orders ord SET opportunity_id = m.twin_id
  FROM merge_pairs_0064 m WHERE ord.opportunity_id = m.oih_id;

-- 3. Re-point the sales order only where the survivor does not already hold that
--    number. For all 62 it does, so nothing moves and the imported copy is
--    dropped by the cascade in step 6.
UPDATE opportunity_sales_orders s SET opportunity_id = m.twin_id
  FROM merge_pairs_0064 m
 WHERE s.opportunity_id = m.oih_id
   AND NOT EXISTS (SELECT 1 FROM opportunity_sales_orders k
                    WHERE k.opportunity_id = m.twin_id AND k.so_number = s.so_number);

-- 4. Correct the survivor's sales order to the value the order register booked,
--    and give it the order date it was missing. This step does not exist in 0063
--    because there the two already agreed.
UPDATE opportunity_sales_orders k
   SET so_value_cr = s.so_value_cr,
       so_date     = COALESCE(k.so_date, s.so_date)
  FROM merge_pairs_0064 m
  JOIN opportunity_sales_orders s ON s.opportunity_id = m.oih_id
 WHERE k.opportunity_id = m.twin_id
   AND k.so_number = s.so_number
   AND k.so_value_cr IS DISTINCT FROM s.so_value_cr;

-- 5. Archive the whole row before it goes.
INSERT INTO opportunities_merge_archive (merged_into_id, tier, opportunity_id, row_data)
SELECT m.twin_id, 'SO-NUM', o.id, to_jsonb(o)
  FROM merge_pairs_0064 m JOIN opportunities o ON o.id = m.oih_id;

-- 6. Retire the duplicate.
DELETE FROM opportunities o USING merge_pairs_0064 m WHERE o.id = m.oih_id;

-- Nothing left behind, and no order left without an opportunity.
DO $$
DECLARE leftover integer; orphaned integer;
BEGIN
  SELECT count(*) INTO leftover FROM opportunities o JOIN merge_pairs_0064 m ON m.oih_id = o.id;
  SELECT count(*) INTO orphaned FROM orders WHERE opportunity_id IS NULL;
  IF leftover > 0 THEN RAISE EXCEPTION 'merge 0064: % duplicate(s) survived the delete', leftover; END IF;
  IF orphaned > 0 THEN RAISE EXCEPTION 'merge 0064: % order(s) left with no opportunity', orphaned; END IF;
END $$;
