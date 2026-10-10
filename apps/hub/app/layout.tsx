import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { Backdrop } from '@/components/backdrop';
import './globals.css';

/**
 * IBM Plex, the same two faces the static page loads from Google Fonts.
 *
 * `next/font` fetches them at build time and serves them from this origin, so
 * there is no render-blocking request to fonts.googleapis.com and no third
 * party sees who visited. The families reach the stylesheet as variables —
 * `--font-sans` and `--font-mono` are redefined in terms of them — so no rule
 * names a font directly.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Risansi Digital — One gateway to every Risansi solution',
  description:
    'Risansi Industries Ltd digital studio — access the Sales Portal, Pump Selection, '
    + 'R&D Testing Portal, and SO to Dispatch from one place.',
  icons: {
    icon: [
      { url: '/assets/favicon.ico', sizes: 'any' },
      { url: '/assets/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/assets/favicon-16.png', type: 'image/png', sizes: '16x16' },
    ],
    apple: '/assets/apple-touch-icon.png',
  },
};

/**
 * Dark is the default and lives on `:root`; light is `:root.light`.
 *
 * The script below runs synchronously while the browser parses <head>, before
 * the first paint, so somebody who chose light mode never sees a dark page
 * flash first. It cannot be a component or an effect: both run after paint.
 * `suppressHydrationWarning` on <html> is what stops React objecting that the
 * class it rendered is not the class now in the DOM — the DOM is right and
 * React should keep it. The pattern is the one in
 * node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
 * ("Themes"), with a class rather than a data attribute because that is what
 * the lifted stylesheet selects on.
 */
const THEME_SCRIPT =
  '(function(){try{if(localStorage.getItem("risansi-theme")==="light")'
  + 'document.documentElement.classList.add("light")}catch(e){}})()';

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Set by proxy.ts, one per request. Next attaches the nonce to its own
  // scripts by reading the CSP header; this one it does not know about, so it
  // has to be carried across by hand or the browser refuses it and the page
  // flashes the wrong theme on every load.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Applied before first paint to avoid a flash. Carries the nonce
            from proxy.ts; without it the Content-Security-Policy blocks it. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Backdrop />
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
