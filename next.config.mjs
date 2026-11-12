import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseAppEnv } from "./src/config/app-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fail fast: `next dev` and `next build` stop here when APP_ENV is missing or invalid.
const appEnv = parseAppEnv(process.env.APP_ENV);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Inlined at build time, so server code sees the same value the build was checked with.
  env: {
    APP_ENV: appEnv,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "velocity-alpha-public-assets.s3.amazonaws.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "velocity-alpha-public-assets.s3.us-east-1.amazonaws.com",
        pathname: "/**",
      },
    ],
  },
  async headers() {
    return [
      // Netlify's cache key ignores query values unless the response names them, so a cached /archive would
      // answer /archive?page=N and the redirect below would never run. Netlify's Next.js runtime merges this
      // into its own Netlify-Vary header. Other query values stay out of the key.
      {
        source: "/archive",
        headers: [{ key: "Netlify-Vary", value: "query=page" }],
      },
    ];
  },
  async redirects() {
    return [
      // Archive pages live in the path so the CDN can cache them. Old `?page=N` links and the archive's
      // page-jump form land on /archive/page/N; Next.js carries the query string along and the page ignores it.
      {
        source: "/archive",
        has: [{ type: "query", key: "page", value: "(?<page>\\d+)" }],
        destination: "/archive/page/:page",
        permanent: true,
      },
    ];
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
