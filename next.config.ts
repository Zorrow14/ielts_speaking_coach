import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root: an unrelated package-lock.json in the home
  // directory otherwise makes Turbopack guess wrong.
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
