-- Four test complaints, raised while the module was being tried out.
--
--   CMP-0150  AADVIK TERRACOTTA ENTERPRISES              "test"
--   CMP-0151  AADVIK TERRACOTTA ENTERPRISES              "test"
--   CMP-0152  SHREE RENUKA SUGARS LTD. (I) (HALDIA)      "no detailes at testing stage"
--   CMP-0153  SHREE RENUKA SUGARS LTD (MUNOLI- BELGAUM)  "Test"
--
-- All four raised on 14 September 2026 by complaintest@, devendra.mishra@ and
-- anamika.katiyar@, with "test" in the description, the contact and the pump
-- model. They carry 15 stage-log rows and 7 attachments, which go with them.
--
-- Matched on the complaint number rather than the id, and every child row is
-- removed first — there is no ON DELETE CASCADE on these foreign keys.
--
-- This cannot be undone. Requested on 26 September 2026.

CREATE TEMP TABLE _bin AS
  SELECT id FROM complaints WHERE complaint_no IN ('CMP-0150', 'CMP-0151', 'CMP-0152', 'CMP-0153');

DELETE FROM complaint_attachments WHERE complaint_id IN (SELECT id FROM _bin);
DELETE FROM complaint_stage_log   WHERE complaint_id IN (SELECT id FROM _bin);
DELETE FROM complaint_updates     WHERE complaint_id IN (SELECT id FROM _bin);
DELETE FROM complaint_photos      WHERE complaint_id IN (SELECT id FROM _bin);
DELETE FROM complaints            WHERE id IN (SELECT id FROM _bin);

DROP TABLE _bin;
