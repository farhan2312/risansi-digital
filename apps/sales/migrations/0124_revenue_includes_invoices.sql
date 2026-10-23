-- Revenue counts invoices raised in the portal, until the month is uploaded.
--
-- ── The problem ─────────────────────────────────────────────────
--
-- Revenue is read in 57 places across a dozen files. Teaching each of them to
-- also consider opportunity_invoices means 57 chances to get it wrong and 57
-- places for the rule to drift. Worse, the invoices must NOT simply be added:
-- the monthly upload from Finance is the authoritative figure, and once it
-- lands for a client and month it already includes everything invoiced in it.
-- Adding both would double-count the same rupees.
--
-- ── What this does instead ──────────────────────────────────────
--
-- The physical table becomes client_revenue_uploaded. A view takes its old
-- name, so all 57 reads keep working untouched and all of them gain the same
-- rule at once:
--
--   an uploaded figure wins wherever one exists for that client and month;
--   invoices fill the gap only where it does not.
--
-- So an invoice shows in revenue the moment it is entered, and the day
-- Finance uploads that month the upload silently takes over. Nothing is
-- counted twice and nothing has to be reconciled by hand.
--
-- ── What the invoice rows cannot say ────────────────────────────
--
-- pump_value and spare_value are NULL on them, not 0. An invoice records one
-- amount; it does not say how much of it was pump and how much spare, and
-- writing 0 would quietly drag the Pump : Spare ratio towards spare. NULL
-- keeps them out of those two sums while their money still counts in
-- total_value — so on a month carried by invoices, pump + spare is less than
-- total. That is honest: the split is genuinely unknown until the upload.
--
-- id is negative on invoice rows so it can never collide with a real row's,
-- and upload_id is NULL, which is also how the uploader tells its own rows
-- apart when deleting an upload.

ALTER TABLE client_revenue_monthly RENAME TO client_revenue_uploaded;

-- The indexes travel with the table; rename them too so the names keep
-- describing what they are on.
ALTER INDEX IF EXISTS client_revenue_monthly_pkey                RENAME TO client_revenue_uploaded_pkey;
ALTER INDEX IF EXISTS client_revenue_monthly_client_id_month_key RENAME TO client_revenue_uploaded_client_id_month_key;

CREATE OR REPLACE VIEW client_revenue_monthly AS
  SELECT id, client_id, month, pump_value, spare_value, total_value,
         notes, entered_by, entered_at, upload_id, half
    FROM client_revenue_uploaded
  UNION ALL
  SELECT
      -i.min_id                                   AS id,
      i.client_id,
      i.month,
      NULL::numeric                               AS pump_value,
      NULL::numeric                               AS spare_value,
      i.total_value,
      i.notes,
      i.entered_by,
      i.entered_at,
      NULL::integer                               AS upload_id,
      NULL::smallint                              AS half
    FROM (
      SELECT oi.client_id,
             date_trunc('month', oi.invoice_date)::date       AS month,
             SUM(oi.invoice_value_inr)                        AS total_value,
             'Invoiced in the portal: ' || string_agg(oi.invoice_no, ', ' ORDER BY oi.invoice_date) AS notes,
             MIN(oi.created_by)                               AS entered_by,
             MAX(oi.created_at)                               AS entered_at,
             MIN(oi.id)                                       AS min_id
        FROM opportunity_invoices oi
       GROUP BY oi.client_id, date_trunc('month', oi.invoice_date)
    ) i
   WHERE NOT EXISTS (
     SELECT 1 FROM client_revenue_uploaded u
      WHERE u.client_id = i.client_id AND u.month = i.month);

COMMENT ON VIEW client_revenue_monthly IS
  'Uploaded revenue, plus portal invoices for any (client, month) with no upload yet. Write to client_revenue_uploaded, never to this.';
