import { Metric } from "@tuya-dashboard/shared";
import {
  fetchLiveDevices,
  fetchRecentPm25,
  HISTORY_WINDOW_HOURS,
  type LiveDevice,
} from "../../lib/tuya-public";
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

const MAX_CHARTED_DEVICES = 4;

export default async function LivePage() {
  let devices: LiveDevice[];
  try {
    devices = await fetchLiveDevices();
  } catch (error) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <h1 className="mb-4 text-xl font-semibold">Air Quality</h1>
        <p className="text-amber-400">
          Could not reach Tuya: {(error as Error).message}
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
    .filter((d) => d.readings.some((r) => r.metric === Metric.PM25))
    .slice(0, MAX_CHARTED_DEVICES);

  const series: TrendSeries[] = await Promise.all(
    charted.map(async (device, i) => ({
      id: device.id,
      label: device.label,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      points: await fetchRecentPm25(device.id),
    })),
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
  }));

  return (
    <main className="mx-auto max-w-5xl p-8">
      <AutoRefresh intervalMs={REFRESH_MS} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Air Quality</h1>
        <div className="flex items-center gap-3">
          <span className="print-hide text-xs text-neutral-500">
            Live from Tuya · refreshes every minute
          </span>
          <ExportPdfButton />
        </div>
      </div>

      {/* Print-only: the nav (and its logo) is hidden on paper, so the PDF
          needs its own dateline. */}
      <p className="mb-6 hidden text-xs text-neutral-600 print:block">
        Generated {new Date().toLocaleString()} · live values from Tuya
      </p>

      <LiveView devices={view} />

      <div className="print-card print-break-inside-avoid mt-8 rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-3 text-sm font-medium text-neutral-400">
          PM2.5 — last {HISTORY_WINDOW_HOURS}h
        </h2>
        <TrendChart series={series} windowHours={HISTORY_WINDOW_HOURS} />
      </div>

      {devices.length === 0 && (
        <p className="text-sm text-neutral-500">
          No air-quality devices are linked to this Tuya account.
        </p>
      )}

      {/* Print only: on screen the mark already sits in the nav bar, which is
          hidden on paper. Normal flow, so it lands once on the last page. */}
      <footer className="print-footer mt-10 hidden items-end justify-between border-t border-neutral-300 pt-4 print:flex">
        <p className="text-[10px] leading-relaxed text-neutral-500">
          PM2.5 in raw µg/m³; AQI per US EPA breakpoints. Live values read from
          the Tuya cloud — this page keeps no history of its own.
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
