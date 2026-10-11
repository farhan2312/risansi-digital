import path from 'node:path';
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== 'production';

// Baseline Content-Security-Policy. The strongest wins here are frame-ancestors
// (clickjacking) and object-src (no plugin embeds); script-src/style-src still
// carry 'unsafe-inline' because Next injects unnonced inline bootstrap/hydration
// scripts and the UI leans heavily on inline style attributes — a nonce-based
// tightening is a separate, larger change. Every PDF / map / screenshot in the
// app opens via <a target="_blank">, so there are no same-page iframes/embeds to
// account for. Dev additionally needs 'unsafe-eval' for HMR.
// Signing out posts to /sign-out here and ends at the hub's sign-in page, and
// `form-action` is enforced across the whole redirect chain of a form
// submission — not just its first hop. With 'self' alone the browser blocks
// the 303 before it leaves, which read as a server error on the page the
// button was clicked from and made signing out impossible. The hub is a real
// form destination for this app now, so it is named as one.
const HUB_ORIGIN = (() => {
  try {
    return new URL(process.env.HUB_URL || 'https://digital.risansi.com').origin;
  } catch {
    return 'https://digital.risansi.com';
  }
})();

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self' ${HUB_ORIGIN}`,
  "frame-ancestors 'none'",
].join('; ');

// Applied to every response (source '/(.*)'). HSTS is inert on http/localhost so
// it is safe to send in all environments.
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy',   value: CSP },
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy',        value: 'geolocation=(self)' },
];

/**
 * The repo root — the parent of both this app and packages/.
 *
 * Turbopack resolves nothing outside its project root, and it works that root
 * out from where the lockfile is, which here is apps/sales. `@risansi/identity`
 * is a `file:` dependency, so npm installs it as a symlink to ../../packages,
 * and that target sits outside. Without this the symlink is present on disk
 * and the build still cannot see through it.
 *
 * Documented at node_modules/next/dist/docs/01-app/03-api-reference/05-config/
 * 01-next-config-js/turbopack.md under "Root directory". apps/hub needs the
 * same line for the same reason.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const nextConfig: NextConfig = {
  // Both of these, set to the same value, and that is not belt-and-braces.
  //
  // Vercel sets outputFileTracingRoot itself. Next then found it disagreeing
  // with turbopack.root, discarded OURS in favour of Vercel's, and resolved
  // module paths against a root that does not contain packages/ — so a build
  // that was clean locally failed with "Can't resolve '@risansi/identity'",
  // having warned "they must have the same value" one line earlier.
  //
  // outputFileTracingRoot pointing at the monorepo base is also what the docs
  // prescribe for this layout; without it, tracing treats apps/sales as the
  // root and leaves out anything above it (01-app/03-api-reference/05-config/
  // 01-next-config-js/output.md, "Caveats").
  outputFileTracingRoot: REPO_ROOT,
  turbopack: {
    root: REPO_ROOT,
  },

  // @risansi/identity ships raw TypeScript and arrives as a `file:` dependency,
  // so npm installs it as a symlink under node_modules and Next compiles
  // nothing there by default. Phase 3 step 1: read-only so far — NextAuth is
  // still what decides who is signed in.
  transpilePackages: ['@risansi/identity'],

  experimental: {
    optimizePackageImports: ['@/components/risansi'],
    serverActions: {
      // Exhibition expenses carry their invoice in the same submit, and a receipt
      // photographed on a phone is routinely 2-5 MB. The default cap is 1 MB,
      // which would reject most of them. 12 MB leaves headroom above the 10 MB
      // per-file limit enforced in lib/risansi-exhibition-files.
      bodySizeLimit: '12mb',
    },
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error'] }
      : false,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
