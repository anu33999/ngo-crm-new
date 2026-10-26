import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Heavy / native server-only packages stay external to the bundle.
  serverExternalPackages: ["@react-pdf/renderer", "exceljs", "cheerio"],
  turbopack: {
    // This folder is the project root, even if a stray package-lock.json sits in a parent folder.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
