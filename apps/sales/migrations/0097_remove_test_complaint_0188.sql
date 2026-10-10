-- One more test complaint, raised while the module was being tried out.
--
--   CMP-0188  AVADH SUGAR & ENERGY LTD. (HARGAON)  "wrong supply"
--             raised 26 September by ram.kishor@, contact "Aviral Shukla"
--
-- Named by the user as a test. It carries one stage-log row and no updates,
-- attachments or photos. Matched on the complaint number, children first —
-- these foreign keys have no ON DELETE CASCADE.
--
-- This cannot be undone. Requested on 1 October 2026.

CREATE TEMP TABLE _bin AS
  SELECT id FROM complaints WHERE complaint_no = 'CMP-0188';

DELETE FROM complaint_attachments WHERE complaint_id IN (SELECT id FROM _bin);
DELETE FROM complaint_stage_log   WHERE complaint_id IN (SELECT id FROM _bin);
DELETE FROM complaint_updates     WHERE complaint_id IN (SELECT id FROM _bin);
DELETE FROM complaint_photos      WHERE complaint_id IN (SELECT id FROM _bin);
DELETE FROM complaints            WHERE id IN (SELECT id FROM _bin);

DROP TABLE _bin;
