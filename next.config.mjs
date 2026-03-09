import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
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
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
