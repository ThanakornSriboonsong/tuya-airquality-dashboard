import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";

// Public deployments run without the backend or the database: only the
// Tuya-fed /live page works there, so the rig-only pages are hidden.
const LIVE_ONLY = process.env.NEXT_PUBLIC_LIVE_ONLY === "1";

export const metadata: Metadata = {
  title: "Air Quality Dashboard",
  description: "Purifier decay-curve and indoor/outdoor PM2.5 comparison rig",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        <Providers>
          <nav className="flex items-center gap-6 border-b border-neutral-800 px-6 py-4 text-sm">
            <span className="flex items-center gap-2.5 font-semibold">
              {/* The logo has a solid white background baked in (no alpha), so
                  it sits on a white chip — dropped straight onto the near-black
                  nav it would read as a stray white rectangle. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="Sure Solutions and Services"
                className="h-7 w-7 rounded-sm bg-white object-contain p-px"
              />
              Air Quality Dashboard
            </span>
            {LIVE_ONLY ? (
              <Link href="/live" className="text-neutral-400 hover:text-neutral-100">
                Live
              </Link>
            ) : (
              <>
                <Link href="/" className="text-neutral-400 hover:text-neutral-100">
                  Dashboard
                </Link>
                <Link
                  href="/devices"
                  className="text-neutral-400 hover:text-neutral-100"
                >
                  Devices
                </Link>
                <Link
                  href="/live"
                  className="text-neutral-400 hover:text-neutral-100"
                >
                  Live
                </Link>
              </>
            )}
          </nav>
          {children}
        </Providers>
      </body>
    </html>
  );
}
