/**
 * The footer from the static page: the copyright line and the four short
 * portal links.
 *
 * The links stay as plain hostnames rather than being rendered from
 * `identity.apps`, because the footer appears on pages that do not query the
 * database at all — the signed-out landing page and the sign-in screen among
 * them — and a row of links is not worth making those depend on it. The grid
 * above is the part that has to tell the truth about who may open what.
 *
 * What they point AT depends on whether anybody is signed in.
 *
 * Signed out they go to /sign-in, for the same reason the tiles do: following
 * one with no session lands you on a portal's own empty or redirected state,
 * which reads as a broken site rather than as being asked to sign in. The
 * hostname is still the label, so the row keeps working as a reminder of what
 * exists and what each is called.
 *
 * Signed in they go to the portal, because by then a session exists and the
 * portal can decide for itself. Note this row does NOT check grants — the
 * tiles do that. Somebody who follows a footer link to a portal they have not
 * been granted gets that portal's refusal, which is the correct answer and is
 * where it belongs once Phase 3 lands.
 */

const QUICK_LINKS = [
  { label: 'sales', url: 'https://sales.risansi.com' },
  { label: 'select', url: 'https://select.risansi.com' },
  { label: 'rndtesting', url: 'https://rndtesting.risansi.com' },
  { label: 'so2dispatch', url: 'https://so2dispatch.risansi.com' },
];

export function SiteFooter({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <footer>
      <span className="copy">© 2026 Risansi Industries Ltd. All rights reserved.</span>
      <nav className="links" aria-label="Portal quick links">
        {QUICK_LINKS.map(link => (
          signedIn ? (
            <a key={link.label} href={link.url} target="_blank" rel="noopener">
              {link.label}
            </a>
          ) : (
            <a
              key={link.label}
              href="/sign-in"
              // The label is a hostname, so without this the link says one
              // thing and goes somewhere else — which is exactly the shape of
              // a link people are taught not to trust.
              aria-label={`${link.label} — sign in to open it`}
              title="Sign in to open this portal"
            >
              {link.label}
            </a>
          )
        ))}
      </nav>
    </footer>
  );
}
