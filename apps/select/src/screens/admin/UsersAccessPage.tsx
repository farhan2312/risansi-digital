"use client";

/**
 * Accounts are managed at Risansi Digital.
 *
 * Phase 4b. This screen approved access requests, changed roles, reset
 * passwords and deactivated accounts. All of it happens once at the hub now,
 * rather than separately in each of three portals.
 *
 * Kept and pointed rather than deleted, and the nav entry stays: somebody
 * looking for user management will look where it used to be, and a page
 * telling them where it went beats a missing menu item they will read as a
 * permissions problem.
 */

const HUB = "https://digital.risansi.com/requests/people";

export default function UsersAccessPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-fg">Users &amp; Access</h1>
      <p className="mt-3 text-fg-2 leading-relaxed">
        Accounts moved to Risansi Digital. Creating somebody, changing their
        role here, resetting a password and switching an account off are all
        done there now, and they reach every portal at once rather than this
        one.
      </p>
      <p className="mt-3 text-fg-2 leading-relaxed">
        Access requests arrive there too. Nobody asks this portal for access
        any more — they ask once, on the hub, for whichever portals they need.
      </p>
      <a
        href={HUB}
        target="_blank"
        rel="noopener"
        className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-white no-underline"
      >
        Manage people at Risansi Digital
      </a>
      <p className="mt-6 text-sm text-fg-3 leading-relaxed">
        You will need approver access there. If you had it here and not there,
        ask an approver to add you — it is one row on their People tab.
      </p>
    </div>
  );
}
