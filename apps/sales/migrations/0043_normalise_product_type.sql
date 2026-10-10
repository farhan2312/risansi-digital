-- One spelling for spares.
--
-- opportunities.product_type carries both 'SPARE' (579) and 'Spares' (396) —
-- 975 rows, the largest product category, split down the middle. The cause is
-- two forms offering different lists: the create wizard reads OPP_FIELDS
-- ('PCP','MMP','Spares','Service','Other') while QuotedDetailsModal had its own
-- hardcoded array ('PCP','MMP','SPARE','OBL'). Whichever form last touched an
-- opportunity decided its spelling.
--
-- Everything that groups by product type — the stage dashboards' product mix,
-- the Product Type filter, the Excel export — shows the category twice as a
-- result. (The weighted-forecast maths is safe: it already matches /spare/i.)
--
-- Canonical form is 'Spares', because OPP_FIELDS is the shared config the create
-- form AND the server validation both read; QuotedDetailsModal is being pointed
-- at the same list so the two can't drift apart again. OBL is kept as a valid
-- value rather than folded away — one real opportunity uses it.

UPDATE opportunities SET product_type = 'Spares'
 WHERE product_type IS NOT NULL
   AND upper(btrim(product_type)) IN ('SPARE', 'SPARES');

-- Trim/upper the remaining fixed codes so a stray ' pcp ' can't start a new
-- split. Anything not in the known set is left exactly as it is.
UPDATE opportunities SET product_type = upper(btrim(product_type))
 WHERE product_type IS NOT NULL
   AND upper(btrim(product_type)) IN ('PCP', 'MMP', 'OBL')
   AND product_type IS DISTINCT FROM upper(btrim(product_type));
