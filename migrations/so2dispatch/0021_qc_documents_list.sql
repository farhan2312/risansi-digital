-- 0021  The QC documents an SO needs, as one multi-select: "MTC, IIR,
-- Dimensional Report" (any of them). Replaces the three Yes / No columns of
-- 0020, carried over once. Apply to ec_to_dispatch before deploying the code
-- that reads it; also in apps/so2dispatch/db/schema.sql. Idempotent and
-- additive.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS qc_documents TEXT;
UPDATE orders SET qc_documents = NULLIF(concat_ws(', ',
         CASE WHEN qc_doc_mtc = 'Yes' THEN 'MTC' END,
         CASE WHEN qc_doc_iir = 'Yes' THEN 'IIR' END,
         CASE WHEN qc_doc_dimensional = 'Yes' THEN 'Dimensional Report' END), '')
 WHERE qc_documents IS NULL
   AND (qc_doc_mtc = 'Yes' OR qc_doc_iir = 'Yes' OR qc_doc_dimensional = 'Yes');
