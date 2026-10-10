-- 0081: territory debtor codes name no person.
--
-- The outstanding upload mapped the sheet's DEBTOR column to a user. AV, MRK
-- and SV are initials and stay mapped; NI, SI and VA are territories, and
-- mapping NI to a rep put his name on the Outstanding tile of 133 clients
-- across every rep's book. Clear those; the code itself stays on the row.

UPDATE clients
   SET outstanding_owner_id = NULL
 WHERE outstanding_debtor_code IN ('NI', 'SI', 'VA')
   AND outstanding_owner_id IS NOT NULL;
