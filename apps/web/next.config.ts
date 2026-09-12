import type { NextConfig } from "next";

// Proxy /api/* to the backend from the Next server rather than from the browser.
// This keeps the frontend on a single origin, so it works unchanged behind a
// tunnel (cloudflared) or any reverse proxy without baking a hostname into the
// bundle. In production Caddy matches /api/* first and this never fires.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }];
  },
};

export default nextConfig;
