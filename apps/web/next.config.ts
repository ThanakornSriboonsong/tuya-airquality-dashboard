import type { NextConfig } from "next";

// Proxy /api/* to the backend from the Next server rather than from the browser.
// This keeps the frontend on a single origin, so it works unchanged behind a
// tunnel (cloudflared) or any reverse proxy without baking a hostname into the
// bundle. In production Caddy matches /api/* first and this never fires.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3001";

// A public deployment has no backend to proxy to — "/" would render a
// dashboard that can only fail, so it redirects to the Tuya-fed live page.
const LIVE_ONLY = process.env.NEXT_PUBLIC_LIVE_ONLY === "1";

const nextConfig: NextConfig = {
  async rewrites() {
    return LIVE_ONLY
      ? []
      : [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }];
  },
  async redirects() {
    return LIVE_ONLY
      ? [{ source: "/", destination: "/live", permanent: false }]
      : [];
  },
};

export default nextConfig;
