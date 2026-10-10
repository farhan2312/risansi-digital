-- Post-event review — one per exhibition.
--
-- Only the figures that CANNOT be derived live here. Companies met, how many were
-- already clients, and total spend are all computed from exhibition_meetings and
-- exhibition_expenses at read time, so they can never drift from the underlying
-- records. What a person has to supply is judgement: leads worth pursuing, what
-- business actually came of it, what we learned, and whether to go again.
--
-- Business figures are RUPEES at numeric(14,2), consistent with the rest of the
-- module, and are never summed into a pipeline or revenue KPI.

CREATE TABLE IF NOT EXISTS exhibition_reviews (
  exhibition_id        integer PRIMARY KEY REFERENCES exhibitions(id) ON DELETE CASCADE,
  new_leads            integer,
  opportunities        integer,
  potential_value_inr  numeric(14,2),
  business_won_inr     numeric(14,2),
  footfall             integer,
  what_worked          text,
  what_did_not         text,
  key_learnings        text,
  competitor_notes     text,
  attend_next_year     text CHECK (attend_next_year IN ('Yes','No','Undecided')),
  next_year_notes      text,
  reviewed_by          integer REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_name     text,
  reviewed_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT NOW(),
  updated_at           timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT exhibition_reviews_counts_ok
    CHECK ((new_leads IS NULL OR new_leads >= 0)
       AND (opportunities IS NULL OR opportunities >= 0)
       AND (footfall IS NULL OR footfall >= 0))
);

COMMENT ON TABLE exhibition_reviews IS
  'Post-event judgement only. Companies met, existing-client hits and spend are derived from exhibition_meetings / exhibition_expenses and deliberately not duplicated here.';
