-- Richer quotation capture: the many extra columns from the Active Quotation
-- List, plus a dynamic list of quoted line items per opportunity.

-- Quote-level attributes on the opportunity itself.
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS market                  varchar(30),
  ADD COLUMN IF NOT EXISTS ril_rep                 varchar(40),
  ADD COLUMN IF NOT EXISTS qtn_prepared_by         varchar(120),
  ADD COLUMN IF NOT EXISTS client_status_at_quote  varchar(20),
  ADD COLUMN IF NOT EXISTS unit_project            text,
  ADD COLUMN IF NOT EXISTS location                text,
  ADD COLUMN IF NOT EXISTS enquiry_date            date,
  ADD COLUMN IF NOT EXISTS revised_offer_date      date,
  ADD COLUMN IF NOT EXISTS qtr                     varchar(6),
  ADD COLUMN IF NOT EXISTS probability_code        varchar(20),
  ADD COLUMN IF NOT EXISTS revised_offer_value_inr numeric,
  ADD COLUMN IF NOT EXISTS revised_offer_value_usd numeric;

-- One row per quoted item (pump line item). A quotation can have several.
CREATE TABLE IF NOT EXISTS opportunity_items (
  id                       serial PRIMARY KEY,
  opportunity_id           integer NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  sort_order               integer NOT NULL DEFAULT 0,
  pump_model               text,
  pump_qty                 integer,
  pump_speed               text,
  geared_motor_detail      text,
  motor_price              numeric,
  gearbox_vbelt_price      numeric,
  offer_value_inr          numeric,
  offer_value_usd          numeric,
  detailed_specifications  text,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opportunity_items_opp ON opportunity_items(opportunity_id);
