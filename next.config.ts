import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mastra болон native SQLite сангуудыг bundle хийхгүй, Node-оос шууд ачаална.
  serverExternalPackages: ["@mastra/*", "@libsql/client", "libsql"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
