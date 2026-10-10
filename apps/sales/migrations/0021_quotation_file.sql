-- Store the uploaded quotation PDF itself (one per opportunity). The document
-- bytes live in their own table so a plain SELECT on opportunities never drags
-- the blob along. quotation_link on the opportunity points at the download
-- endpoint for an uploaded file (or stays an external URL for legacy links).

CREATE TABLE IF NOT EXISTS opportunity_quotation_files (
  opportunity_id integer PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,
  file_name      text NOT NULL,
  mime           text NOT NULL DEFAULT 'application/pdf',
  size           integer,
  bytes          bytea NOT NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now()
);
