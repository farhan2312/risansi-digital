/**
 * The header, on every page.
 *
 * It resolves the viewer itself rather than taking them as a prop, because
 * `getViewer()` is wrapped in React's `cache()` — the page and this component
 * share one database read per request, and no page has to remember to pass it
 * down.
 *
 * What the right-hand side holds depends on who is looking:
 *
 *   signed out   the hostname tag, the theme toggle, Sign in
 *   member       their address, the theme toggle, Sign out
 *   approver     the same, plus a link into the access-request queue
 *
 * That last link is **rendered only for an approver** — not hidden with CSS,
 * not disabled. A member's HTML does not mention /requests, so reading the
 * page source tells them nothing about it. The page and each of its actions
 * check the role again on the server; this is a convenience, not the boundary.
 */

import { ThemeToggle } from '@/components/theme-toggle';
import { signOutAction } from '@/app/actions/auth';
import { getViewer, pendingGrantCount } from '@/lib/viewer';

export async function SiteHeader({
  /** Off on the sign-in page itself, where the button would point at the page
   *  you are already looking at. */
  showSignIn = true,
}: { showSignIn?: boolean } = {}) {
  const viewer = await getViewer();
  // Only an approver's page asks the question at all.
  const pending = viewer?.role === 'approver' ? await pendingGrantCount() : 0;

  return (
    <header>
      <a className="logo-chip" href="/" aria-label="Risansi Digital — home">
        {/* A plain <img>: this is a fixed-size logo in the header on every
            page, so there is nothing for the image optimiser to decide. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo.png" alt="Risansi Industries Ltd" />
      </a>

      <div className="header-right">
        {viewer
          ? <span className="header-who" title={viewer.email}>{viewer.email}</span>
          : <span className="header-tag">digital.risansi.com</span>}

        {viewer?.role === 'approver' && (
          <a
            className="header-ctl"
            href="/requests"
            // Spelled out for a screen reader, which would otherwise read the
            // count pill as a bare number next to the label.
            aria-label={pending > 0 ? `Access requests, ${pending} waiting` : 'Access requests'}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 5.5h16" />
              <path d="M4 12h16" />
              <path d="M4 18.5h10" />
              <path d="M17.5 17.5l1.8 1.8 3.2-3.6" />
            </svg>
            Access requests
            {pending > 0 && (
              <span className="count-pill" aria-hidden="true">{pending}</span>
            )}
          </a>
        )}

        <ThemeToggle />

        {viewer
          ? (
            <form action={signOutAction}>
              <button className="header-ctl" type="submit">Sign out</button>
            </form>
          )
          : showSignIn && <a className="btn btn-small" href="/sign-in">Sign in</a>}
      </div>
    </header>
  );
}
