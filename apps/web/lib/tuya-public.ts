import "server-only";

import { TuyaContext } from "@tuya/tuya-connector-nodejs";
import {
  KNOWN_DP_METRIC_MAP,
  Metric,
  parseDpValues,
  pm25ToAqi,
  type Placement,
} from "@tuya-dashboard/shared";

/**
 * Read-only Tuya access for the public site.
 *
 * This is the database-less half of the project: it renders whatever Tuya is
 * holding right now, with no poller and no SQLite behind it, so it can run on
 * free serverless hosting. The rig at home keeps its own permanent history —
 * nothing here writes anything.
 *
 * `server-only` is load-bearing. The Tuya access secret and each device's
 * `local_key` must never reach the browser, so importing this from a client
 * component is a build error rather than a leak.
 */

const SPEC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface LiveReading {
  metric: Metric;
  value: number;
  unit: string;
  aqi: number | null;
}

export interface LiveDevice {
  id: string;
  label: string;
  placement: Placement | null;
  /** Tuya's own connectivity flag — the device's view, not ours. */
  online: boolean;
  /**
   * False when the values look like a power-on frame rather than a
   * measurement. See `looksLikeBootFrame`.
   */
  reporting: boolean;
  readings: LiveReading[];
}

/**
 * Detects the sensors' power-on frame: every metric zero with CO₂ pinned at
 * 511, published for a while after the device reconnects.
 *
 * This matters far more here than on the rig. The device-status endpoint
 * carries no per-value timestamp — that is exactly why the poller reads
 * report-logs instead — so this page cannot tell a fresh reading from a stale
 * one by age. Tuya also keeps reporting `online: true` throughout, so the
 * connectivity flag is no help either.
 *
 * Without this check a booting indoor sensor reads 0.0 µg/m³ and the page
 * announces "−100% lower indoors": a confident, completely false claim about
 * the purifier, shown publicly.
 *
 * Keyed on temperature and humidity rather than PM2.5, because 0 µg/m³ is a
 * legitimate reading whereas 0 °C at 0 % RH simultaneously is not something
 * these sensors can produce in a room.
 */
function looksLikeBootFrame(readings: LiveReading[]): boolean {
  const valueOf = (metric: Metric) =>
    readings.find((r) => r.metric === metric)?.value;

  const temperature = valueOf(Metric.TEMPERATURE);
  const humidity = valueOf(Metric.HUMIDITY);

  return temperature === 0 && humidity === 0;
}

const REQUIRED_ENV = [
  "TUYA_ACCESS_ID",
  "TUYA_ACCESS_SECRET",
  "TUYA_BASE_URL",
  "TUYA_UID",
] as const;

/**
 * Reports every missing variable at once.
 *
 * Checking them one at a time makes a misconfigured deployment look like a
 * single missing value, so you fix that one, redeploy, and meet the next —
 * four builds to learn that none of them were set.
 */
function requireEnv(name: (typeof REQUIRED_ENV)[number]): string {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    // Fail loudly: a public page that renders empty because a secret is
    // missing looks identical to a rig with no sensors.
    throw new Error(
      `Missing environment variable${missing.length > 1 ? "s" : ""}: ` +
        `${missing.join(", ")}. Set ${missing.length > 1 ? "these" : "this"} ` +
        `in your host's environment settings, then redeploy.`,
    );
  }

  return process.env[name] as string;
}

let context: TuyaContext | null = null;
function tuya(): TuyaContext {
  if (!context) {
    context = new TuyaContext({
      baseUrl: requireEnv("TUYA_BASE_URL"),
      accessKey: requireEnv("TUYA_ACCESS_ID"),
      secretKey: requireEnv("TUYA_ACCESS_SECRET"),
    });
  }
  return context;
}

/**
 * Placement is a physical fact about where a sensor sits, and with no database
 * there is nowhere to record it — so the deployment carries it as config:
 *
 *   PUBLIC_DEVICE_PLACEMENTS={"a3d3b7a8...":"indoor","a37db94d...":"outdoor"}
 *
 * A device missing from the map still renders; it just cannot take part in the
 * indoor-vs-outdoor comparison.
 */
function placements(): Record<string, Placement> {
  const raw = process.env.PUBLIC_DEVICE_PLACEMENTS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, Placement> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (value === "indoor" || value === "outdoor") out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Scale factors per DP code, cached in module memory.
 *
 * Hard rule 1 says scale is read from the device, never hardcoded — but a
 * model's specification does not change, so re-fetching it on every render
 * would just burn API quota. Cached for a day and shared across renders in
 * the same serverless instance.
 */
const specCache = new Map<string, { at: number; scales: Map<string, number> }>();

async function scalesFor(deviceId: string): Promise<Map<string, number>> {
  const cached = specCache.get(deviceId);
  if (cached && Date.now() - cached.at < SPEC_CACHE_TTL_MS) return cached.scales;

  const res = await tuya().request<{
    status: Array<{ code: string; type: string; values: string }>;
  }>({ method: "GET", path: `/v1.0/devices/${deviceId}/specifications` });

  const scales = new Map<string, number>();
  for (const dp of res.result?.status ?? []) {
    scales.set(dp.code, parseDpValues(dp.values).scale);
  }

  specCache.set(deviceId, { at: Date.now(), scales });
  return scales;
}

/**
 * Every registered device with its current values, in one Tuya call.
 *
 * `/v1.0/users/{uid}/devices` returns the inline `status` array alongside the
 * `online` flag, so the whole page costs one request plus a cached
 * specification lookup per device.
 */
export async function fetchLiveDevices(): Promise<LiveDevice[]> {
  const uid = requireEnv("TUYA_UID");

  const res = await tuya().request<
    Array<{
      id: string;
      name: string;
      online: boolean;
      status: Array<{ code: string; value: unknown }>;
    }>
  >({ method: "GET", path: `/v1.0/users/${uid}/devices` });

  const placementById = placements();
  const devices: LiveDevice[] = [];

  for (const device of res.result ?? []) {
    const scales = await scalesFor(device.id);
    const readings: LiveReading[] = [];

    for (const dp of device.status ?? []) {
      const metric = KNOWN_DP_METRIC_MAP[dp.code];
      if (!metric) continue; // alarms, battery, brightness — not measurements

      const raw = Number(dp.value);
      if (!Number.isFinite(raw)) continue;

      // Tuya reports integers with a declared decimal shift, e.g. voc_value
      // 141 at scale 3 is 0.141 mg/m³.
      const value = raw / 10 ** (scales.get(dp.code) ?? 0);

      readings.push({
        metric,
        value,
        unit: "",
        aqi: metric === Metric.PM25 ? pm25ToAqi(value) : null,
      });
    }

    devices.push({
      id: device.id,
      label: device.name.trim() || device.id,
      placement: placementById[device.id] ?? null,
      online: device.online,
      reporting: readings.length > 0 && !looksLikeBootFrame(readings),
      readings,
    });
  }

  return devices;
}
