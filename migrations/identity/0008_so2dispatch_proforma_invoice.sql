-- 0008  SO to Dispatch's Billing & Operations department is now called
-- Proforma Invoice. The role code stays `operations`; only what an approver
-- reads changes. Idempotent.
UPDATE identity.app_roles
   SET label = 'Proforma Invoice'
 WHERE app_slug = 'so2dispatch' AND role = 'operations';
