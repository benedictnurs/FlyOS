import type { NextConfig } from "next";

const brainOrigin = process.env.BRAIN_ORIGIN ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  agentRules: false,
  async rewrites() {
    return [
      {
        source: "/brain/:path*",
        destination: `${brainOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
