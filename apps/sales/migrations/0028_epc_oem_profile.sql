-- EPC / OEM account intelligence, captured on the visit report's Client Type
-- page and persisted on the client (latest-wins, prefilled next visit). Only
-- meaningful for client_type EPC or OEM; null everywhere else. 'EPC' also joins
-- the client_type option set (a plain string column, so no enum change needed).
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS focus_industries         text[],
  ADD COLUMN IF NOT EXISTS avg_annual_pump_req       integer,
  ADD COLUMN IF NOT EXISTS ongoing_tenders           integer,
  ADD COLUMN IF NOT EXISTS upcoming_tenders          boolean,
  ADD COLUMN IF NOT EXISTS upcoming_tenders_details  text,
  ADD COLUMN IF NOT EXISTS pcp_suppliers             text;
