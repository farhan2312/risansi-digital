-- "End Client" flag: a client we supply indirectly (via an OEM / trader), i.e.
-- no direct business. Used as its own row in the executive Turnover Summary.
-- There's no way to infer this from revenue, so it's a manual tag.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_end_client boolean NOT NULL DEFAULT false;
