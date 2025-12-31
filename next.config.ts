import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    webpackBuildWorker: false,
  },
  webpack: (config, { isServer }) => {
    config.watchOptions = {
      ...(config.watchOptions ?? {}),
      poll: 1000,
      aggregateTimeout: 300,
    };

    return config;
  },
};

export default nextConfig;
