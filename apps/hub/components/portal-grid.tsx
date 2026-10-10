'use client';

/**
 * The grid, and the cursor-tracking glow on the cards inside it.
 *
 * The static page attached a `pointermove` listener to each card and fed the
 * cursor position into `--mx` / `--my`, which the `.card::after` radial
 * gradient reads. Here it is one listener on the grid that finds the card
 * under the pointer, which does the same thing without caring how many tiles
 * the database returns.
 *
 * Not gated on `prefers-reduced-motion`: it responds to the cursor rather
 * than animating on its own. Touch devices skip it, because there is no hover
 * there and the glow would stick wherever the last tap landed.
 *
 * A Client Component, so the tiles are passed in as children and keep being
 * rendered on the server.
 */

import type { PointerEvent, ReactNode } from 'react';

export function PortalGrid({ children }: { children: ReactNode }) {
  function track(event: PointerEvent<HTMLElement>) {
    if (!window.matchMedia('(hover: hover)').matches) return;

    const card = (event.target as HTMLElement | null)?.closest<HTMLElement>('.card');
    if (!card) return;

    const box = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${event.clientX - box.left}px`);
    card.style.setProperty('--my', `${event.clientY - box.top}px`);
  }

  return (
    <main className="grid" onPointerMove={track}>
      {children}
    </main>
  );
}
