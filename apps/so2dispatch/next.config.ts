import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Allow larger Excel uploads through server actions (default is 1 MB).
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
