import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Dev only: lets a Cloudflare quick tunnel (used to test the Telegram bot) load the dev assets.
  allowedDevOrigins: ["*.trycloudflare.com"],
  cacheComponents: true,
  // The in-chat Approve card's script is read from node_modules at request time.
  outputFileTracingIncludes: {
    "/mcp-assets/app": ["./node_modules/@modelcontextprotocol/ext-apps/dist/src/app-with-deps.js"],
  },
  partialPrefetching: true,
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
