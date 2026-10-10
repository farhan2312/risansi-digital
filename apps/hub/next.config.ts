import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * The repo root, which is the parent of both this app and packages/.
 *
 * Turbopack resolves nothing outside its project root, and it detects that
 * root by looking for a lockfile — which here is apps/hub/package-lock.json,
 * so the detected root is this directory. `@risansi/identity` and
 * `@risansi/notify` arrive as `file:` dependencies, which npm installs as
 * symlinks into ../../packages, and those targets are outside it.
 *
 * The documented fix for a monorepo is to point `root` at the parent of both
 * (node_modules/next/dist/docs/01-app/03-api-reference/05-config/
 * 01-next-config-js/turbopack.md, "Root directory"). The alternative,
 * `experimental.turbopackAdditionalRoots`, is narrower but experimental, and
 * its own docs warn that CI may fail to copy files it does not know about.
 *
 * Kept even though the build currently runs on webpack (see below), because
 * the day the packages' import specifiers are fixed this is already right and
 * dropping `--webpack` is the only change needed.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const nextConfig: NextConfig = {
  // Set together and equal. Vercel supplies its own outputFileTracingRoot, and
  // when the two disagree Next discards turbopack.root and resolves against
  // Vercel's — which does not contain packages/. That broke the sales build
  // even though it was clean locally, because the conflict only exists on
  // Vercel. This app has the same exposure whether or not it has bitten yet.
  outputFileTracingRoot: REPO_ROOT,
  turbopack: {
    root: REPO_ROOT,
  },

  // Turbopack, not webpack. The shared packages used to import each other as
  // `./session.js` where the file is `session.ts`, which webpack resolves via
  // extensionAlias and Turbopack does not do at all — so this app shipped with
  // `--webpack` and an experimental.extensionAlias block. The specifiers now
  // say `.ts`, which both bundlers resolve and Node runs directly under
  // --experimental-strip-types, so the opt-out is gone.

  // Both shared packages ship raw TypeScript — `main` and `exports` point at
  // ./src/index.ts. Next compiles nothing under node_modules by default, and
  // the symlinked packages are under node_modules, so this opts them in.
  transpilePackages: ['@risansi/identity', '@risansi/notify'],


};

export default nextConfig;
