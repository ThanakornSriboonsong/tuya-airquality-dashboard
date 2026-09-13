"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the server component on an interval.
 *
 * The page itself is cached for 60s, so this asks the server for a fresh
 * render rather than hitting Tuya directly — the cache decides whether a new
 * API call actually happens. Without it the page would show whatever was
 * current when the tab was opened, indefinitely.
 */
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
