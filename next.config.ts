import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native SQLite driver must stay external (cannot be bundled).
  serverExternalPackages: ["better-sqlite3"],
  reactStrictMode: true,
};

export default nextConfig;
