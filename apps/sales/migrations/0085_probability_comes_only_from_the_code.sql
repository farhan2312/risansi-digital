-- An opportunity's odds come from the probability code a rep enters, and from
-- nowhere else.
--
-- Until now, creating an opportunity wrote the stage's own guess into the
-- numeric `probability` column — 60 for Quoted, 40 for Prospect, 20 from the
-- visit form. Nobody chose those numbers. The result was a kanban card reading
-- "60%" over a drawer whose Probability field was blank, because there was no
-- code behind the number: 171 quoted opportunities were in that state, plus 9
-- negotiating, 32 prospect and 62 suspect.
--
-- The application no longer reads this column for the forecast — it weights
-- from probability_code directly — so this migration is a tidy-up: it clears
-- the numbers nobody entered and keeps the rest in step with their code.

-- The runner wraps each migration in its own transaction, so this file does
-- not open one of its own.

-- 1. No code, no number.
UPDATE opportunities
   SET probability = NULL
 WHERE (probability_code IS NULL OR btrim(probability_code) = '')
   AND probability IS NOT NULL;

-- 2. Where a code exists, the number is its percentage and nothing else. They
--    agree on every row today; this keeps them agreeing if one is ever written
--    by hand.
UPDATE opportunities o
   SET probability = v.pct
  FROM (VALUES ('1', 90), ('2', 40), ('3', 20), ('4', 0)) AS v(code, pct)
 WHERE btrim(o.probability_code) = v.code
   AND o.probability IS DISTINCT FROM v.pct;
