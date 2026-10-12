import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` and the Anthropic SDK are server-only native/node deps — keep them
  // external to the server bundle so Next doesn't try to bundle them.
  serverExternalPackages: ["pg", "@anthropic-ai/sdk"],
  // A stray package-lock.json under the user's home dir made Next infer the
  // wrong workspace root; pin it to this app.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
