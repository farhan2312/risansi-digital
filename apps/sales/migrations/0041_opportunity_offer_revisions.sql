-- Revised offers become a history, not a single field.
--
-- A quote gets re-priced more than once: quoted 10,00,000 → revised to
-- 8,50,000 when the client pushes back → revised to 11,00,000 when the scope
-- grows. The old shape (one revised_offer_value_inr + one revised_offer_date)
-- could only remember the last of those, so every earlier number was silently
-- overwritten. This table keeps them all, in order.
--
-- Values are RUPEES, matching opportunities.offer_value_inr (not crores — that
-- unit is only used by opportunities.value_cr / final_value_cr).
--
-- opportunities.revised_offer_value_inr / revised_offer_date stay, now as a
-- denormalised mirror of the LATEST revision. Every read site that already
-- shows "the revised offer" (Excel export, opportunity drawer, quote summary)
-- keeps working untouched; the server re-syncs both columns whenever the
-- revision list changes. revised_offer_value_usd is no longer written — USD is
-- derived from the settings rate at display time.

CREATE TABLE IF NOT EXISTS opportunity_offer_revisions (
  id             serial PRIMARY KEY,
  opportunity_id integer NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  value_inr      numeric NOT NULL,
  revised_on     date NOT NULL,
  note           text,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opp_offer_rev_opp
  ON opportunity_offer_revisions (opportunity_id, revised_on, id);

-- Backfill the single revised offer each opportunity currently carries as its
-- first revision, so nothing is lost when the forms switch over. Where no
-- revised_offer_date was recorded, fall back to the quote date, then to the row
-- creation date. Guarded so a re-run can't duplicate.
INSERT INTO opportunity_offer_revisions (opportunity_id, value_inr, revised_on, note, created_by)
SELECT o.id,
       o.revised_offer_value_inr,
       COALESCE(o.revised_offer_date, o.quote_date, o.created_at::date, CURRENT_DATE),
       'Migrated from the single revised-offer field',
       'system'
  FROM opportunities o
 WHERE o.revised_offer_value_inr IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM opportunity_offer_revisions r WHERE r.opportunity_id = o.id
   );

-- Keep the mirror honest for the rows just backfilled (some had a null date).
UPDATE opportunities o
   SET revised_offer_date = r.revised_on
  FROM (
    SELECT DISTINCT ON (opportunity_id) opportunity_id, revised_on
      FROM opportunity_offer_revisions
     ORDER BY opportunity_id, revised_on DESC, id DESC
  ) r
 WHERE r.opportunity_id = o.id
   AND o.revised_offer_date IS DISTINCT FROM r.revised_on;
