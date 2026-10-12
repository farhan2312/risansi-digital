import path from "node:path";

import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Risansi Digital, named in form-action below.
 *
 * A browser enforces form-action across the WHOLE redirect chain of a form
 * submission, not just its first hop. Signing out posts here and ends at the
 * hub, so with 'self' alone the browser blocks the redirect before it leaves
 * — and it surfaces as a generic server error on the page the button was
 * clicked from, with nothing in the server logs. That cost most of a day on
 * the sales portal; it is named here before the sign-out exists rather than
 * after.
 */
const HUB_ORIGIN = (() => {
  try {
    return new URL(process.env.HUB_URL || "https://digital.risansi.com").origin;
  } catch {
    return "https://digital.risansi.com";
  }
})();

/**
 * Content-Security-Policy. The app loads nothing from other origins (no CDN,
 * no web fonts, no analytics), so everything is pinned to 'self'.
 *
 * - script-src keeps 'unsafe-inline': Next.js emits inline bootstrap/hydration
 *   scripts, and a nonce-based policy needs middleware on every request. This
 *   still stops external script loading, framing, form hijacking and plugins;
 *   moving to nonces is the next hardening step. 'unsafe-eval' is dev-only
 *   (React Refresh).
 * - style-src 'unsafe-inline' because components use inline style attributes.
 * - blob: on img/object/frame: attachments and screenshots are fetched as
 *   blobs and opened in a new tab.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'self' blob:",
  "frame-src 'self' blob:",
  "base-uri 'self'",
  `form-action 'self' ${HUB_ORIGIN}`,
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // One year, this host only -- deliberately no includeSubDomains, because
  // sibling apps under the same domain (sales-portal-next) manage their own.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

// pdfkit is PINNED to 0.15.2 (see package.json) -- 0.20.x rewrote standard-font loading onto Node's
// package.json `imports` map (`#standard-fonts/Helvetica` etc.), and neither Next's bundler nor
// Vercel's function runtime resolves that: it 500'd in production with "Cannot find module
// '#standard-fonts/Helvetica'" (confirmed via a throwaway smoke-test route hitting prod directly),
// while working fine locally (`next dev`/`next build && next start` don't hit whatever Vercel-side
// wrapper breaks that resolution). 0.15.2 predates that rewrite and reads its bundled .afm font
// metrics off disk at runtime instead (fs.readFileSync) -- bundling it would break that path
// resolution, so it's kept external here, same reason "pg" is.
const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "pdfkit"],
  // @risansi/identity ships raw TypeScript and arrives as a `file:` dependency,
  // so npm installs it as a symlink and Next compiles nothing there by default.
  transpilePackages: ["@risansi/identity"],
  // The repo root, not this directory, now that the app imports from
  // ../../packages. Vercel sets this itself for a monorepo; when its value and
  // ours disagree Next discards ours, which is how the sales deploy failed with
  // "Can't resolve '@risansi/identity'" after a clean local build.
  outputFileTracingRoot: path.join(import.meta.dirname, "..", ".."),
  // The admin-only documentation PDFs are read from disk at request time, so Vercel must bundle them
  // with that route's function (they are deliberately not in /public).
  outputFileTracingIncludes: { "/api/admin-docs/[name]": ["./private-docs/**/*"] },
  // Don't advertise the framework in every response.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
