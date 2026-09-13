import type { LatestReadingDto } from "@tuya-dashboard/shared";

/**
 * How long a device may go without reporting before the dashboard calls it
 * offline.
 *
 * Well above the 60s poll interval, so a slow poll or a device that reports
 * every few minutes is never mislabelled. The point is to catch a sensor that
 * has actually stopped — unplugged, out of battery, off the network.
 */
export const OFFLINE_AFTER_MS = 30 * 60 * 1000;

export type DeviceState = "live" | "offline" | "no-data";

export interface DeviceStatus {
  state: DeviceState;
  /** Device-reported timestamp of the most recent reading, not the poll time. */
  lastSeen: number | null;
  ageMs: number | null;
}

/**
 * Freshness of one device, from the readings already on screen.
 *
 * Staleness is judged on the device-reported `ts` (hard rule 3), so a device
 * that went quiet an hour ago reads as an hour stale even though the poller
 * has been running the whole time.
 */
export function deviceStatus(
  readings: LatestReadingDto[],
  now: number,
  thresholdMs: number = OFFLINE_AFTER_MS,
): DeviceStatus {
  if (readings.length === 0) {
    return { state: "no-data", lastSeen: null, ageMs: null };
  }

  let lastSeen = readings[0].ts;
  for (const r of readings) {
    if (r.ts > lastSeen) lastSeen = r.ts;
  }

  // A clock skew between the browser and the device can put the newest reading
  // slightly in the future; clamp so that never renders as a negative age.
  const ageMs = Math.max(0, now - lastSeen);

  return {
    state: ageMs > thresholdMs ? "offline" : "live",
    lastSeen,
    ageMs,
  };
}

/** Compact human age: "4 min", "1 h 12 min", "2 d 3 h". */
export function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes === 0 ? `${hours} h` : `${hours} h ${restMinutes} min`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} d` : `${days} d ${restHours} h`;
}
