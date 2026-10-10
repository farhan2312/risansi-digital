/**
 * One tile.
 *
 * The static page had four hand-written `<a class="card">` blocks. This is the
 * one component that replaces them, and the state it renders comes from
 * `tileState()` in @risansi/identity — the hub does not decide what Approved
 * or Revoked means, the package does, and every portal will read the same
 * answer when it checks its own grant.
 *
 *   open       a link into the portal
 *   request    the same shell with a Request access form in the footer
 *   requested  muted, "Requested", nothing to click
 *   refused    muted, "Not granted", with the approver's note if they left one
 *
 * The shell is identical in all four so the grid does not reflow as somebody's
 * standing changes; only the footer and the dimming differ.
 */

import type { AppTile } from '@risansi/identity';
import { tileState } from '@risansi/identity';
import { PortalIcon } from '@/components/portal-icon';
import { RequestAccessForm } from '@/components/request-access-form';
import { displayHost } from '@/lib/marketing-tiles';

function Top({ slug, number }: { slug: string; number: string }) {
  return (
    <div className="card-top">
      <PortalIcon slug={slug} />
      <span className="card-num">{number}</span>
    </div>
  );
}

function Arrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="M12 5l7 7-7 7" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function BlockedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6.2 6.2l11.6 11.6" />
    </svg>
  );
}

/**
 * The signed-out tile: a plain link out, exactly as the static page has it.
 * Nobody's standing is known, so nothing is claimed about it — clicking
 * through lands on the portal, which bounces them back here to sign in.
 */
export function MarketingTileCard({
  slug, name, url, blurb, number,
}: {
  slug: string; name: string; url: string; blurb: string; number: string;
}) {
  return (
    <a className="card reveal" href={url} target="_blank" rel="noopener">
      <Top slug={slug} number={number} />
      <h2>{name}</h2>
      <p>{blurb}</p>
      <div className="card-foot">
        <span className="card-url">{displayHost(url)}</span>
        <span className="card-go">Open portal<Arrow /></span>
      </div>
    </a>
  );
}

export function PortalTile({ tile, number }: { tile: AppTile; number: string }) {
  const state = tileState(tile);
  const host = displayHost(tile.url);
  const blurb = tile.blurb ?? '';

  if (state === 'open') {
    return (
      <a className="card reveal" href={tile.url} target="_blank" rel="noopener">
        <Top slug={tile.slug} number={number} />
        <h2>{tile.name}</h2>
        <p>{blurb}</p>
        <div className="card-foot">
          <span className="card-url">{host}</span>
          <span className="card-go">Open portal<Arrow /></span>
        </div>
      </a>
    );
  }

  if (state === 'request') {
    return (
      <div className="card card-static reveal">
        <Top slug={tile.slug} number={number} />
        <h2>{tile.name}</h2>
        <p>{blurb}</p>
        <RequestAccessForm slug={tile.slug} host={host} />
      </div>
    );
  }

  if (state === 'requested') {
    return (
      <div className="card card-static card-dim reveal">
        <Top slug={tile.slug} number={number} />
        <h2>{tile.name}</h2>
        <p>{blurb}</p>
        <div className="card-foot">
          <span className="card-url">{host}</span>
          <span className="state-chip"><ClockIcon />Requested</span>
        </div>
      </div>
    );
  }

  // refused — Rejected and Revoked both land here. The two stay distinct in
  // the database because they are different conversations, but the tile says
  // the same thing either way and the note carries the detail.
  return (
    <div className="card card-static card-dim reveal">
      <Top slug={tile.slug} number={number} />
      <h2>{tile.name}</h2>
      <p>{blurb}</p>
      {tile.decidedNote && <p className="tile-note">{tile.decidedNote}</p>}
      <div className="card-foot">
        <span className="card-url">{host}</span>
        <span className="state-chip"><BlockedIcon />Not granted</span>
      </div>
    </div>
  );
}
