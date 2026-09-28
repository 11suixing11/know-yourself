import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The API routes use Node.js runtime features (cookies and SQLite), so the
  // application must be deployed as a self-hosted Node server.
  output: "standalone",
  // Keep the local preview visually clean. Compile and runtime errors still
  // surface through Next.js itself when they occur.
  devIndicators: false,
  // Keep the native SQLite package outside the webpack bundle. Output file
  // tracing then copies its JavaScript loader and native addon into the
  // standalone release.
  serverExternalPackages: ["better-sqlite3", "sharp"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/better-sqlite3/**/*",
      "./node_modules/bindings/**/*",
      "./node_modules/sharp/**/*",
      "./node_modules/@img/**/*",
      "./scripts/media-worker.mjs",
      "./scripts/media-backup.mjs",
      "./scripts/media-restore.mjs",
      "./scripts/standalone-supervisor.cjs",
    ],
  },
  images: {
    unoptimized: true,
  },
  rewrites() {
    return [{
      source: "/media/public/:revisionId/:assetId/:width.webp",
      destination: "/api/journal/media/public/:revisionId/:assetId/:width",
    }];
  },
  trailingSlash: true,
  // Better Auth endpoints are slashless. Let the catch-all route receive the
  // original API path instead of Next's page-oriented slash redirect.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
