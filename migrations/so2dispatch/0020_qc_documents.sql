-- 0020  Quality restructured. The SO says which QC documents it needs (when
-- Quality is Yes): MTC, IIR, Dimensional Report, each Yes / No. Quality gives
-- each needed document per EC as a SharePoint link with the day it was
-- submitted (order_qc_doc_links); once every needed one is in, the EC's
-- Actual Date of Doc. Submission is the last of those days. Replaces the
-- uploaded files and Central's requirement files for new work.
-- Apply to ec_to_dispatch before deploying the code that reads it; also in
-- apps/so2dispatch/db/schema.sql. Idempotent and additive.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS qc_doc_mtc TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS qc_doc_iir TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS qc_doc_dimensional TEXT;

CREATE TABLE IF NOT EXISTS order_qc_doc_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id         UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    doc_type        TEXT NOT NULL CHECK (doc_type IN ('MTC', 'IIR', 'Dimensional Report')),
    link            TEXT,
    submitted_date  DATE,
    remarks         TEXT,
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (item_id, doc_type)
);
DROP TRIGGER IF EXISTS order_qc_doc_links_set_updated_at ON order_qc_doc_links;
CREATE TRIGGER order_qc_doc_links_set_updated_at BEFORE UPDATE ON order_qc_doc_links
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
