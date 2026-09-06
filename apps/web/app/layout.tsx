import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Air Quality Test Rig",
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
          <nav className="flex gap-6 border-b border-neutral-800 px-6 py-4 text-sm">
            <span className="font-semibold">Air Quality Test Rig</span>
            <Link href="/" className="text-neutral-400 hover:text-neutral-100">
              Dashboard
            </Link>
            <Link href="/devices" className="text-neutral-400 hover:text-neutral-100">
              Devices
            </Link>
          </nav>
          {children}
        </Providers>
      </body>
    </html>
  );
}
