-- Segregate the single PROSPECTIVE status into two, keyed off the code type:
--   LEAD_ code  → PROSPECTIVE_LEAD   (a raw lead, auto-coded)
--   real code   → PROSPECTIVE_CLIENT (enquiry arrived, has an ERP client code)
-- Also normalises the 19 mis-cased 'Prospective' rows (all real-coded) in the
-- same pass. Rows already marked DUPLICATE/CLOSED/etc. are left untouched.

UPDATE clients
   SET status = 'PROSPECTIVE_LEAD', updated_at = now()
 WHERE status IN ('PROSPECTIVE', 'Prospective')
   AND code LIKE 'LEAD_%';

UPDATE clients
   SET status = 'PROSPECTIVE_CLIENT', updated_at = now()
 WHERE status IN ('PROSPECTIVE', 'Prospective')
   AND code NOT LIKE 'LEAD_%';
