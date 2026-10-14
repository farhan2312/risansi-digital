import path from "node:path";
import type { NextConfig } from "next";

/**
 * The repo root — the parent of this app and of packages/. Turbopack resolves
 * nothing outside its root, which it otherwise takes from where the lockfile
 * is (here); `@risansi/identity` is a `file:` dependency installed as a
 * symlink to ../../packages, outside that. Same setup as apps/sales, which
 * is on the same Next version.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const nextConfig: NextConfig = {
  // Both, to the same value: Vercel sets outputFileTracingRoot itself for a
  // monorepo, and when it disagrees with turbopack.root Next keeps Vercel's
  // and the build fails with "Can't resolve '@risansi/identity'" (apps/sales).
  outputFileTracingRoot: REPO_ROOT,
  turbopack: {
    root: REPO_ROOT,
  },
  // @risansi/identity ships raw TypeScript; Next compiles nothing under
  // node_modules unless told to.
  transpilePackages: ["@risansi/identity"],
  experimental: {
    // Allow larger Excel uploads through server actions (default is 1 MB).
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
