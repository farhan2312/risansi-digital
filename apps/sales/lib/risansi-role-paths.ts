/**
 * What a narrow role may open, in one place.
 *
 * Three roles exist to do one small thing each, and none of them climbs the
 * `rep → manager → admin` ladder. What they can reach is therefore not a
 * level test but a list, and this is the list.
 *
 * ── Why a list and not a set of blocks ──────────────────────────
 *
 * An allowlist fails closed. A screen added next month is unreachable for
 * these roles until somebody names it here, which is the right default: the
 * alternative is a new page quietly inheriting an audience it was never
 * designed for. The cost is that adding a page for them is two lines rather
 * than none, and that cost is the feature.
 *
 * ── Why this file has no imports ────────────────────────────────
 *
 * It is read by both `proxy.ts`, which runs on the edge, and
 * `app/risansi/layout.tsx`, which runs on the server. Importing anything from
 * `lib/risansi-auth.ts` would pull `pg` into the edge bundle. Both ends need
 * the same answer and the previous version of this rule was written out twice,
 * once in each file, which is how `staff` ended up with a sidebar listing ten
 * screens it is redirected away from.
 *
 * `/print/client` is on every list that includes Client 360: it is the same
 * client data, laid out for paper.
 */

export interface RoleSurface {
  /** Page prefixes this role may open. Exact match, or a sub-path. */
  paths: string[];
  /** Where to send them when they ask for anything else, and their home. */
  home: string;
  /** The sidebar heading, since "Sales" is not what any of them is doing. */
  navLabel: string;
  /** Sidebar entries to keep, by `SALES_NAV` id. */
  navIds: string[];
}

export const NARROW_ROLES: Record<string, RoleSurface> = {
  // Complaints, and the client an arriving complaint is about.
  staff: {
    paths: ['/risansi/clients', '/risansi/complaints', '/print/client'],
    home: '/risansi/complaints',
    navLabel: 'Complaints',
    navIds: ['client360', 'complaints'],
  },

  // Look a client up. Added 16 Oct 2026: twelve of the thirteen admins owned no
  // accounts and held admin purely to read Client 360, so this is that, and
  // only that. The whole page, read-only, exportable.
  viewer: {
    paths: ['/risansi/clients', '/print/client'],
    home: '/risansi/clients',
    navLabel: 'Clients',
    navIds: ['client360'],
  },

  // The Action Registry, plus the clients actions are raised against — an
  // action hangs off a client, so the register is unusable without it.
  registry: {
    paths: ['/risansi/clients', '/risansi/registry', '/print/client'],
    home: '/risansi/registry',
    navLabel: 'Actions',
    navIds: ['registry', 'client360'],
  },
};

/** The role's surface, or null for anybody on the ordinary ladder. */
export function narrowSurface(role: string | null | undefined): RoleSurface | null {
  return (role && NARROW_ROLES[role]) || null;
}

/**
 * May this role open this path?
 *
 * True for every role that is not narrow — this answers the allowlist question
 * only, and says nothing about the admin gates, which are a separate test on
 * both ends.
 */
export function mayOpen(role: string | null | undefined, pathname: string): boolean {
  const surface = narrowSurface(role);
  if (!surface) return true;
  return surface.paths.some(p => pathname === p || pathname.startsWith(`${p}/`));
}
