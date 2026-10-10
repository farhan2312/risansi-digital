/**
 * The two roles worth a second look before approving.
 *
 * Sales `sysadmin` carries user management, targets, settings and password
 * resets — ten people already hold it (MIGRATION_PLAN.md §7.4 flags that as
 * something to look at). SO to Dispatch `admin` carries everything Central
 * Visibility has plus user management.
 *
 * Neither is blocked, and this is not a permission check. It only marks them
 * in the approval list so the heaviest grant in the dropdown does not look
 * like the other ten.
 */
const HEAVY: ReadonlySet<string> = new Set([
  'sales:sysadmin',
  'so2dispatch:admin',
]);

export function isHeavyRole(appSlug: string, role: string): boolean {
  return HEAVY.has(`${appSlug}:${role}`);
}
