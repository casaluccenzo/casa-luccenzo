import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives in a subdirectory of the casa-luccenzo repo, which has
  // its own package-lock.json at the root -- without this, Next.js can't
  // tell which lockfile marks the real workspace root.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
