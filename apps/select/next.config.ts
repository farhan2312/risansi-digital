import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` and the Anthropic SDK are server-only native/node deps — keep them
  // external to the server bundle so Next doesn't try to bundle them.
  serverExternalPackages: ["pg", "@anthropic-ai/sdk"],
  // @risansi/identity ships raw TypeScript and arrives as a `file:` dependency,
  // so npm installs it as a symlink and Next compiles nothing there by default.
  transpilePackages: ["@risansi/identity"],
  // Was pinned to this directory, to stop a stray package-lock.json under the
  // user's home dir making Next infer the wrong workspace root. The repo root
  // now, because the app imports from ../../packages — and it has to agree
  // with what Vercel sets for a monorepo or Next discards ours, which is how
  // the sales deploy failed with "Can't resolve '@risansi/identity'".
  outputFileTracingRoot: path.join(import.meta.dirname, "..", ".."),
};

export default nextConfig;
