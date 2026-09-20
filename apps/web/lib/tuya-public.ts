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

/**
 * History window for the public chart and the PDF report.
 *
 * Tuya's maximum page size is 100 — 200 and 500 are both rejected as illegal —
 * so cost is set entirely by how often the sensors report, which is far more
 * than it appears. Measured directly against the live API: 772 CO₂ readings in
 * a single hour from one device. A full day of CO₂ is therefore ~186 pages per
 * device, which is more than a public page should spend.
 *
 * So 24h is the window we *ask* for, not a guarantee. `MetricHistory.truncated`
 * and `coveredFrom` report what actually came back.
 */
const HISTORY_HOURS = 24;
const HISTORY_PAGE_SIZE = 100;

/**
 * The window is fetched as this many independently-bounded ranges, run with
 * bounded concurrency. Chunking is what keeps a long window inside the
 * serverless function timeout that ISR revalidation runs in — see
 * `fetchRecentMetric`.
 */
const HISTORY_CHUNKS = 12;
const HISTORY_CONCURRENCY = 4;

/**
 * Total pages per device per metric, spent newest-range-first.
 *
 * At ~770 readings/hour this buys roughly nine contiguous hours of the
 * chattiest metric; quiet metrics reach the full day and stop early on their
 * own, so the budget costs nothing when it is not needed.
 *
 * Raising it is a straight trade of API quota and page latency for older data.
 * What must not change is the newest-first spending: see `fetchRecentMetric`
 * for why dividing it evenly between chunks perforates the series instead.
 */
const HISTORY_MAX_PAGES = 72;

/**
 * A metric switch is interactive, but it gets the same budget as a page render:
 * a tighter one buys a shorter window, not a faster one, because the budget is
 * spent newest-first either way.
 */
const ON_DEMAND_MAX_PAGES = HISTORY_MAX_PAGES;

/**
 * History is cached far longer than the page itself (60s). A 24-hour trend does
 * not visibly change minute to minute, and at 23–60 calls per device this is
 * the difference between a flat quota and an alarming one.
 */
const HISTORY_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Chart history costs a paginated Tuya call per device, so the number of
 * charted devices is capped: pairing a dozen sensors must not quietly
 * multiply the API usage of every refresh.
 */
export const MAX_CHARTED_DEVICES = 4;

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
/**
 * Shared by the page render and the history endpoint, so a viewer switching
 * the chart metric does not cost a second device listing.
 */
const DEVICE_CACHE_TTL_MS = 30 * 1000;
let deviceCache: { at: number; devices: LiveDevice[] } | null = null;

export async function fetchLiveDevices(): Promise<LiveDevice[]> {
  if (deviceCache && Date.now() - deviceCache.at < DEVICE_CACHE_TTL_MS) {
    return deviceCache.devices;
  }

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

    // Not an air-quality sensor. The Tuya account may hold lights, plugs, or
    // anything else the owner has paired; a device exposing none of our
    // metrics would otherwise render as an empty card on a public page.
    // A sensor that reports metrics but is mid-boot is a different case and
    // is kept, badged, below.
    if (readings.length === 0) continue;

    devices.push({
      id: device.id,
      label: device.name.trim() || device.id,
      placement: placementById[device.id] ?? null,
      online: device.online,
      reporting: !looksLikeBootFrame(readings),
      readings,
    });
  }

  deviceCache = { at: Date.now(), devices };
  return devices;
}

export interface HistoryPoint {
  ts: number;
  value: number;
}

export interface MetricHistory {
  /** Raw readings, oldest first. Statistics are computed from these. */
  points: HistoryPoint[];
  /**
   * True when the page budget ran out while Tuya still had more to give, so
   * the series covers less than the requested window.
   *
   * Reported rather than hidden: the previous version silently stopped at the
   * page cap and still labelled the chart "last 6h" while showing about two
   * hours of CO₂ — a quietly wrong axis, which is the failure CLAUDE.md's
   * hard rule 5 exists to prevent.
   */
  truncated: boolean;
  /** Oldest timestamp actually retrieved, or null when nothing came back. */
  coveredFrom: number | null;
}

const historyCache = new Map<string, { at: number; history: MetricHistory }>();

/** Remaining page allowance, shared across the chunks of one fetch. */
interface PageBudget {
  left: number;
}

/**
 * Pages one bounded time range until Tuya says there is no more, or the shared
 * budget runs out.
 */
async function fetchChunk(
  deviceId: string,
  code: string,
  scale: number,
  startTime: number,
  endTime: number,
  budget: PageBudget,
): Promise<{ points: HistoryPoint[]; exhausted: boolean }> {
  const points: HistoryPoint[] = [];
  let lastRowKey: string | undefined;

  while (budget.left > 0) {
    budget.left--;

    const res = await tuya().request<{
      has_more: boolean;
      last_row_key: string;
      list: Array<{ code: string; value: string; event_time: number }>;
    }>({
      method: "GET",
      path: `/v1.0/iot-03/devices/${deviceId}/report-logs`,
      query: {
        codes: code,
        start_time: startTime,
        end_time: endTime,
        size: HISTORY_PAGE_SIZE,
        ...(lastRowKey ? { last_row_key: lastRowKey } : {}),
      },
    });

    for (const entry of res.result?.list ?? []) {
      const raw = Number(entry.value);
      if (!Number.isFinite(raw)) continue;
      // Tuya reports integers with a declared decimal shift.
      points.push({ ts: entry.event_time, value: raw / 10 ** scale });
    }

    if (!res.result?.has_more) return { points, exhausted: false };
    lastRowKey = res.result.last_row_key;
  }

  // Budget ran out with more still available for this range.
  return { points, exhausted: true };
}

/**
 * Recent history of one metric for one device, from Tuya's report history.
 *
 * The DP code is looked up from the device's own specification rather than
 * assumed — hard rule 1. Different sensor models name the same quantity
 * differently, and hardcoding `pm25_value` here would silently chart nothing
 * on a model that calls it something else.
 *
 * The window is split into chunks fetched concurrently. Pages inside one chunk
 * must be sequential because each needs the previous `last_row_key`, but
 * `start_time`/`end_time` bound every request independently, so separate chunks
 * do not share a cursor and can overlap in flight. That matters: a day of CO₂ is
 * about 60 pages, and 60 sequential round trips would exceed the serverless
 * function timeout that ISR revalidation runs inside.
 *
 * Cached per device AND metric, so switching the chart costs one round of calls
 * and then nothing for the cache lifetime, for every visitor.
 */
export async function fetchRecentMetric(
  deviceId: string,
  metric: Metric,
  pageBudget: number = HISTORY_MAX_PAGES,
): Promise<MetricHistory> {
  const cacheKey = `${deviceId}:${metric}:${pageBudget}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < HISTORY_CACHE_TTL_MS) return cached.history;

  const empty: MetricHistory = { points: [], truncated: false, coveredFrom: null };

  const scales = await scalesFor(deviceId);
  const code = [...scales.keys()].find(
    (dpCode) => KNOWN_DP_METRIC_MAP[dpCode] === metric,
  );
  if (!code) return empty;

  const scale = scales.get(code) ?? 0;
  // Same 5s lag buffer the poller uses: a report still being ingested at the
  // instant we ask would otherwise fall outside the window.
  const endTime = Date.now() - 5_000;
  const startTime = endTime - HISTORY_HOURS * 60 * 60 * 1000;

  const chunkMs = (endTime - startTime) / HISTORY_CHUNKS;
  const chunks = Array.from({ length: HISTORY_CHUNKS }, (_, i) => ({
    from: Math.round(startTime + i * chunkMs),
    to: Math.round(startTime + (i + 1) * chunkMs),
  }));

  /*
   * Newest chunk first, against a budget shared by all of them.
   *
   * This ordering is the whole point. These sensors can emit ~770 readings an
   * hour, so a full day of the chattiest metric is ~186 pages per device —
   * more than is worth spending on a public page. Something has to give, and
   * *what* gives matters: dividing the budget evenly between chunks made every
   * chunk keep only its newest pages, perforating the series with a hole in
   * each one. Spending newest-first instead means the oldest chunks are simply
   * never fetched, so a short window is contiguous and `coveredFrom` states
   * honestly how far back it actually reaches.
   */
  const ordered = [...chunks].reverse();
  const budget: PageBudget = { left: pageBudget };
  const fetched: Array<{ points: HistoryPoint[]; exhausted: boolean }> = [];

  for (let i = 0; i < ordered.length; i += HISTORY_CONCURRENCY) {
    if (budget.left <= 0) break;
    const wave = ordered.slice(i, i + HISTORY_CONCURRENCY);
    fetched.push(
      ...(await Promise.all(
        wave.map((chunk) =>
          fetchChunk(deviceId, code, scale, chunk.from, chunk.to, budget),
        ),
      )),
    );
  }

  /*
   * Keep the newest unbroken run and discard anything older.
   *
   * Chunks in a wave share the budget and race for it, so the wave where the
   * budget runs dry comes back part-funded: some of its ranges complete, others
   * stop early and are missing their older end. Concatenating all of it would
   * reintroduce exactly the holes the newest-first ordering exists to avoid.
   *
   * A chunk that reported `exhausted` is incomplete at its old edge, so it is
   * the last one worth keeping — everything beyond it is dropped even though it
   * was already paid for. That costs some data and buys a series whose gaps are
   * only ever real sensor silence, never an artefact of our own budgeting.
   */
  const usable: Array<{ points: HistoryPoint[]; exhausted: boolean }> = [];
  for (const chunk of fetched) {
    usable.push(chunk);
    if (chunk.exhausted) break;
  }

  // Chunk boundaries are exclusive in practice, but a reading landing exactly on
  // one would otherwise appear twice and skew the mean.
  const byTs = new Map<number, number>();
  for (const chunk of usable) {
    for (const point of chunk.points) byTs.set(point.ts, point.value);
  }

  const points = [...byTs.entries()]
    .map(([ts, value]) => ({ ts, value }))
    .sort((a, b) => a.ts - b.ts);

  const history: MetricHistory = {
    points,
    // Either a range was cut short, or older ranges were never fetched or were
    // discarded above for being incomplete.
    truncated:
      usable.some((chunk) => chunk.exhausted) || usable.length < ordered.length,
    coveredFrom: points.length > 0 ? points[0].ts : null,
  };

  historyCache.set(cacheKey, { at: Date.now(), history });
  return history;
}

export const HISTORY_WINDOW_HOURS = HISTORY_HOURS;
export const HISTORY_ON_DEMAND_PAGE_BUDGET = ON_DEMAND_MAX_PAGES;
