import { Metric } from "@tuya-dashboard/shared";
import {
  fetchLiveDevices,
  fetchRecentMetric,
  MAX_CHARTED_DEVICES,
  HISTORY_WINDOW_HOURS,
  type LiveDevice,
} from "../../lib/tuya-public";
import { downsample } from "../../lib/series";
import { summarise, type MetricSummary } from "../../lib/report-stats";
import { AutoRefresh } from "./auto-refresh";
import { ExportPdfButton } from "./export-pdf-button";
import { TrendChart, type TrendSeries } from "./trend-chart";
import { LiveView, type ViewDevice } from "./live-view";

/**
 * Public, database-free view: renders whatever Tuya holds right now.
 *
 * Cached for 60 seconds, so Tuya is called at most once a minute no matter how
 * many people load the page. That keeps the API quota flat under traffic —
 * without it, every visitor would cost a request.
 */
export const revalidate = 60;

const REFRESH_MS = 60_000;

// Print-safe: these read clearly on both the dark screen and white paper.
const SERIES_COLORS = ["#16a34a", "#2563eb", "#c2410c", "#7c3aed"];

// Rendered server-side so the first paint needs no client request.
const DEFAULT_METRIC = Metric.PM25;

// Roughly a point a minute over 24h — past this the chart stutters and the
// payload balloons, with nothing gained that the eye can resolve.
const CHART_MAX_POINTS = 1440;


export default async function LivePage() {
  let devices: LiveDevice[];
  try {
    devices = await fetchLiveDevices();
  } catch (error) {
    // The detail goes to the server log rather than the page: the message can
    // name configuration variables, which a public site should not advertise.
    console.error("Live page could not load sensor data:", error);
    return (
      <main className="mx-auto max-w-5xl p-8">
        <h1 className="mb-4 text-xl font-semibold">Air Quality</h1>
        <p className="text-amber-400">
          Live readings are unavailable right now. Please try again shortly.
        </p>
      </main>
    );
  }

  // Any PM2.5 sensor is charted, so a newly paired device appears on the chart
  // without touching PUBLIC_DEVICE_PLACEMENTS or redeploying. History is a
  // paginated Tuya call per device, so the count is capped: pairing a dozen
  // sensors must not quietly multiply the API usage of every refresh.
  // Cached for 5 minutes inside tuya-public, independent of this page's 60s.
  const charted = devices
    .filter((d) => d.readings.some((r) => r.metric === DEFAULT_METRIC))
    .slice(0, MAX_CHARTED_DEVICES);

  /*
   * History never fails the page.
   *
   * This render also runs at build time, where the sensor cloud may simply be
   * unreachable — a Netlify build died exactly here, on `report-logs` timing
   * out, after the device listing had already succeeded. Current values are
   * what the page is for; a missing chart is a degraded page, not a broken
   * deployment, and the next revalidation picks the history back up.
   */
  const histories = await Promise.all(
    charted.map(async (device) => {
      try {
        return await fetchRecentMetric(device.id, DEFAULT_METRIC);
      } catch (error) {
        console.error(
          `History unavailable for ${device.label}:`,
          (error as Error).message,
        );
        return { points: [], truncated: true, coveredFrom: null };
      }
    }),
  );

  // The line is thinned for drawing; the statistics below use every raw reading.
  const series: TrendSeries[] = charted.map((device, i) => ({
    id: device.id,
    label: device.label,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    points: downsample(histories[i].points, CHART_MAX_POINTS),
  }));

  const truncated = histories.some((h) => h.truncated);
  // How far back the data actually reaches, so the chart can say so instead of
  // implying it covers the full window.
  const covered = histories
    .map((h) => h.coveredFrom)
    .filter((ts): ts is number => ts !== null);
  const coveredHours =
    covered.length > 0 ? (Date.now() - Math.min(...covered)) / 3_600_000 : null;

  // Only metrics some sensor actually reports. Listing PM10 when no device
  // has a pm10 DP would just offer an option that charts nothing; a sensor
  // that does report it appears here automatically.
  const METRIC_ORDER: Metric[] = [
    Metric.PM25,
    Metric.PM10,
    Metric.CO2,
    Metric.TEMPERATURE,
    Metric.HUMIDITY,
    Metric.VOC,
    Metric.CH2O,
  ];
  const reported = new Set(devices.flatMap((d) => d.readings.map((r) => r.metric)));
  const availableMetrics = METRIC_ORDER.filter((m) => reported.has(m));

  // Summaries come from the raw readings, never the thinned chart series: a
  // bucketed mean would flatten exactly the spikes min/max exist to report.
  const summaryByDevice = new Map<string, MetricSummary | null>(
    charted.map((device, i) => [
      device.id,
      summarise(DEFAULT_METRIC, histories[i].points),
    ]),
  );

  // PUBLIC_DEVICE_PLACEMENTS supplies the placement everyone sees first; the
  // viewer reassigns it in the browser from here on.
  const view: ViewDevice[] = devices.map((d) => ({
    id: d.id,
    label: d.label,
    placement: d.placement,
    online: d.online,
    reporting: d.reporting,
    readings: d.readings.map((r) => ({
      metric: r.metric,
      value: r.value,
      aqi: r.aqi,
    })),
    summary: summaryByDevice.get(d.id) ?? null,
  }));

  return (
    <main className="mx-auto max-w-5xl p-8">
      <AutoRefresh intervalMs={REFRESH_MS} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Air Quality</h1>
        <div className="flex items-center gap-3">
          <span className="print-hide text-xs text-neutral-500">
            Live readings · refreshes every minute
          </span>
          <ExportPdfButton />
        </div>
      </div>

      {/* Print-only: the nav (and its logo) is hidden on paper, so the PDF
          needs its own dateline. */}
      <p className="mb-6 hidden text-xs text-neutral-600 print:block">
        Generated {new Date().toLocaleString()} · live sensor readings
      </p>

      <LiveView devices={view} windowHours={HISTORY_WINDOW_HOURS} />

      <div className="print-card print-break-inside-avoid mt-8 rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-3 text-sm font-medium text-neutral-400">
          Trend — last {HISTORY_WINDOW_HOURS}h
        </h2>
        <TrendChart
          series={series}
          windowHours={HISTORY_WINDOW_HOURS}
          truncated={truncated}
          coveredHours={coveredHours}
          availableMetrics={availableMetrics}
          defaultMetric={DEFAULT_METRIC}
          colors={SERIES_COLORS}
        />
      </div>

      {devices.length === 0 && (
        <p className="text-sm text-neutral-500">
          No air-quality devices are linked to this account.
        </p>
      )}

      {/* Print only: on screen the mark already sits in the nav bar, which is
          hidden on paper. Normal flow, so it lands once on the last page. */}
      <footer className="print-footer mt-10 hidden items-end justify-between border-t border-neutral-300 pt-4 print:flex">
        <p className="text-[10px] leading-relaxed text-neutral-500">
          PM2.5 in raw µg/m³; AQI per US EPA breakpoints. Statistics use every
          reading in the window; the chart line is averaged into time buckets for
          legibility. Read live from the sensor cloud — this page keeps no
          history of its own.
        </p>
        <div className="print-logo flex flex-col items-end gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Sure Solutions and Services"
            className="h-14 w-auto"
          />
          <p className="text-[10px] font-medium italic tracking-wide text-neutral-500">
            Think for a Better World
          </p>
        </div>
      </footer>
    </main>
  );
}
