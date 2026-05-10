import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/devices", destination: "/yachts", permanent: false },
      { source: "/devices/:deviceId", destination: "/yachts/serenity/devices/:deviceId", permanent: false }
    ];
  }
};

export default nextConfig;
