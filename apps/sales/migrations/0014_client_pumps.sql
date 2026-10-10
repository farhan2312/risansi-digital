-- 0014  Customer-wise RIL pump detail (our pumps supplied to customers).
--
-- One row per pump-detail line from STAGE-9 Customer_Wise_Pump_Detail. These are
-- Risansi's own pumps; the Client 360 page shows them and flags any discrepancy
-- between the installed-base RIL count (competitor_installed_base ril_pcp+ril_mmp)
-- and how many pumps we hold detailed records for (sum of quantity here).
--
-- Match to a client by the reversed customer code: the file codes are the client
-- code with the two halves swapped ([seq][01][city] vs [city][01][seq]), e.g.
-- D02501AHMD -> AHMD01D025. client_id is null for codes with no matching client.

CREATE TABLE IF NOT EXISTS client_pumps (
  id                 serial PRIMARY KEY,
  client_id          integer REFERENCES clients(id),
  client_code        text,                 -- derived (reversed) code used to match
  customer_code      text,                 -- original file code (e.g. D02501AHMD)
  cust_code_short    text,                 -- the short CUST_CODE col (e.g. A001), when present
  customer_name      text,
  consignee_name     text,
  consignee_city     text,
  so_number          text,
  so_date            date,
  so_val             numeric,
  cust_po_number     text,
  product_code       text,
  product_name       text,
  quantity           integer NOT NULL DEFAULT 1,
  ec_number          text,
  ec_date            date,
  pump_sl_no         text,                 -- report "SR No."
  pump_model_plate   text,                 -- report "Model" (Pump Model No As Per Plate)
  model_no_internal  text,
  liquid             text,
  capacity           text,
  head               text,
  pump_speed         text,
  drive_rating       text,
  source_period      text,                 -- '2012-2021' | 'April21-MAY26'
  source             text NOT NULL DEFAULT 'import',
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_pumps_client ON client_pumps(client_id);
CREATE INDEX IF NOT EXISTS idx_client_pumps_code   ON client_pumps(client_code);
