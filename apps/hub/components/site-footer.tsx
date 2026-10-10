/**
 * The footer from the static page: the copyright line and the four short
 * portal links.
 *
 * The links stay as plain hostnames rather than being rendered from
 * `identity.apps`, because the footer appears on pages that do not query the
 * database at all — the signed-out landing page and the sign-in screen among
 * them — and a row of links is not worth making those depend on it. The grid
 * above is the part that has to tell the truth about who may open what.
 */

const QUICK_LINKS = [
  { label: 'sales', url: 'https://sales.risansi.com' },
  { label: 'select', url: 'https://select.risansi.com' },
  { label: 'rndtesting', url: 'https://rndtesting.risansi.com' },
  { label: 'so2dispatch', url: 'https://so2dispatch.risansi.com' },
];

export function SiteFooter() {
  return (
    <footer>
      <span className="copy">© 2026 Risansi Industries Ltd. All rights reserved.</span>
      <nav className="links" aria-label="Portal quick links">
        {QUICK_LINKS.map(link => (
          <a key={link.label} href={link.url} target="_blank" rel="noopener">
            {link.label}
          </a>
        ))}
      </nav>
    </footer>
  );
}
