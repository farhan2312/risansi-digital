"use client";

/**
 * Accounts are managed at Risansi Digital.
 *
 * Phase 4b. This screen created people, changed their roles, reset passwords
 * and deactivated accounts. All four now happen once, at the hub, instead of
 * separately in each of three portals.
 *
 * The screen is kept and pointed rather than deleted, and the nav entry stays.
 * Somebody looking for user management will look where it used to be, and a
 * page that tells them where it went is worth more than a missing menu item
 * they assume is a permissions problem.
 */

const HUB = "https://digital.risansi.com/requests/people";

export default function AdminUsersPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-fg">Users &amp; Access</h1>
      <p className="mt-3 text-fg-2 leading-relaxed">
        Accounts moved to Risansi Digital. Creating somebody, changing what
        they can do here, resetting a password and switching an account off are
        all done there now — and they reach every portal at once instead of
        just this one.
      </p>
      <p className="mt-3 text-fg-2 leading-relaxed">
        Roles for this portal are still this portal&rsquo;s own. They are
        chosen when access is granted, from the same list you used here.
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
