-- 0099  Per-rep annual targets: seed users.target_cr for every active rep.
--
-- The column has existed since the users table was built but has never been
-- written: it was NULL for all 49 rows, so anything wanting a per-rep target
-- had nothing to read and fell back to the one company figure in
-- app_settings.annual_target_cr. Management has not yet sent the real per-rep
-- split, so the starting values here are an equal share of that company figure
-- rather than blanks — a provisional number that adds up is usable today,
-- whereas a blank reads as "target zero" wherever a percentage is computed.
--
-- Equal share means company_target / number_of_active_reps, so the rep targets
-- SUM to the company figure. It does not mean giving each rep the whole company
-- figure: eighteen people each carrying ₹45 Cr would describe an ₹810 Cr year.
--
-- "Active rep" is the same set the rest of the portal means by it —
-- is_active AND role IN ('rep','manager') — the identical predicate the
-- Executive Review's TSM roster and the Reps & Managers page already use.
-- admin / sysadmin / staff accounts are back-office and carry no quota, so they
-- stay NULL and are not shown on the Settings list.
--
-- Only NULL targets are filled, so re-running this never overwrites a figure
-- somebody has since typed on the Settings page.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_target_cr_nonneg;
ALTER TABLE users
  ADD CONSTRAINT users_target_cr_nonneg CHECK (target_cr IS NULL OR target_cr >= 0);

COMMENT ON COLUMN users.target_cr IS
  'Individual annual revenue target in Crores. NULL means no target has been set, '
  'in which case readers fall back to an equal share of app_settings.annual_target_cr. '
  'Seeded provisionally by migration 0099 pending the real split from management.';

UPDATE users u
   SET target_cr  = s.share,
       updated_at = NOW()
  FROM (
    SELECT round(
             COALESCE(
               (SELECT NULLIF(value, '')::numeric FROM app_settings WHERE key = 'annual_target_cr'),
               32)
             / GREATEST(
                 (SELECT count(*) FROM users WHERE is_active AND role IN ('rep', 'manager')),
                 1),
             2) AS share
  ) s
 WHERE u.is_active
   AND u.role IN ('rep', 'manager')
   AND u.target_cr IS NULL;
