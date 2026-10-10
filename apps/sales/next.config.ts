import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== 'production';

// Baseline Content-Security-Policy. The strongest wins here are frame-ancestors
// (clickjacking) and object-src (no plugin embeds); script-src/style-src still
// carry 'unsafe-inline' because Next injects unnonced inline bootstrap/hydration
// scripts and the UI leans heavily on inline style attributes — a nonce-based
// tightening is a separate, larger change. Every PDF / map / screenshot in the
// app opens via <a target="_blank">, so there are no same-page iframes/embeds to
// account for. Dev additionally needs 'unsafe-eval' for HMR.
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
  "form-action 'self'",
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

const nextConfig: NextConfig = {
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
