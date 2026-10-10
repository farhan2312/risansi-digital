/**
 * The portal grid — the front page, signed in or out.
 *
 * Signed out it is the marketing page it has always been: the same hero, the
 * same four tiles, the same copy, each one a link straight out to its portal.
 * It asks the database nothing, so it keeps working whatever the state of the
 * identity schema.
 *
 * Signed in, the same grid is rendered from `tilesFor()` — every live row in
 * `identity.apps` with that person's standing against each. The look does not
 * change; the footer of each tile does.
 */

import { redirect } from 'next/navigation';
import { tilesFor } from '@risansi/identity';
import db from '@/lib/db';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { PortalGrid } from '@/components/portal-grid';
import { MarketingTileCard, PortalTile } from '@/components/portal-tile';
import { MARKETING_TILES, tileNumber, twoDigit } from '@/lib/marketing-tiles';
import { getViewer } from '@/lib/viewer';

function Hero({ name }: { name?: string }) {
  return (
    <section className="hero">
      <span className="eyebrow"><span className="dot" />Risansi Industries Ltd</span>
      <h1>Risansi <span className="accent">Digital&nbsp;Studio</span></h1>
      <p>
        {name
          ? `Welcome back, ${name}. Everything you have been given access to is below.`
          : 'One gateway to every digital solution at Risansi — from first enquiry to '
            + 'final dispatch. Pick a portal below to get started.'}
      </p>
    </section>
  );
}

export default async function Page() {
  // Reads the session cookie, which is a Request-time API, so this route is
  // rendered per request and `next build` never opens a database connection.
  const viewer = await getViewer();

  if (!viewer) {
    return (
      <>
        <SiteHeader />
        <Hero />
        <div className="grid-label">Solutions · {twoDigit(MARKETING_TILES.length)}</div>
        <PortalGrid>
          {MARKETING_TILES.map((tile, i) => (
            <MarketingTileCard
              key={tile.slug}
              slug={tile.slug}
              name={tile.name}
              url={tile.url}
              blurb={tile.blurb}
              number={tileNumber(i)}
            />
          ))}
        </PortalGrid>
        <SiteFooter />
      </>
    );
  }

  // Somebody holding an issued password gets the change-password screen and
  // nothing else until they have chosen one.
  if (viewer.mustChangePassword) redirect('/change-password');

  const tiles = await tilesFor(db, viewer.id);
  // First name only. The full name is in the header if they want to check it.
  const firstName = viewer.name.trim().split(/\s+/)[0];

  return (
    <>
      <SiteHeader />
      <Hero name={firstName} />
      <div className="grid-label">Solutions · {twoDigit(tiles.length)}</div>
      {tiles.length === 0
        ? <p className="empty">No applications are listed yet.</p>
        : (
          <PortalGrid>
            {tiles.map((tile, i) => (
              <PortalTile key={tile.slug} tile={tile} number={tileNumber(i)} />
            ))}
          </PortalGrid>
        )}
      <SiteFooter signedIn />
    </>
  );
}
