import { Metric } from "@tuya-dashboard/shared";
import {
  fetchLiveDevices,
  fetchRecentPm25,
  HISTORY_WINDOW_HOURS,
  type LiveDevice,
} from "../../lib/tuya-public";
import { aqiColor } from "../../lib/aqi-color";
import { METRIC_LABELS, METRIC_UNITS } from "../../lib/metric-labels";
import { AutoRefresh } from "./auto-refresh";
import { ExportPdfButton } from "./export-pdf-button";
import { TrendChart, type TrendSeries } from "./trend-chart";

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
const SERIES_COLORS = ["#16a34a", "#2563eb", "#c2410c"];

const METRIC_ORDER: Metric[] = [
  Metric.CO2,
  Metric.TEMPERATURE,
  Metric.HUMIDITY,
  Metric.VOC,
  Metric.CH2O,
];

function decimals(metric: Metric) {
  return metric === Metric.VOC || metric === Metric.CH2O ? 3 : 1;
}

function DeviceCard({ device }: { device: LiveDevice }) {
  // Either condition means the numbers must not be read as a measurement.
  const trusted = device.online && device.reporting;
  const pm25 = device.readings.find((r) => r.metric === Metric.PM25);
  const others = METRIC_ORDER.map((m) =>
    device.readings.find((r) => r.metric === m),
  ).filter((r): r is NonNullable<typeof r> => r !== undefined);

  return (
    <div className="print-card print-break-inside-avoid rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-medium text-neutral-400">{device.label}</h2>
        {device.placement && (
          <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-500">
            {device.placement}
          </span>
        )}
        {!trusted && (
          <span className="ml-auto rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
            {device.online ? "No valid reading" : "Offline"}
          </span>
        )}
      </div>

      {/* Tuya keeps serving the last known values after a device drops off, so
          an offline card is dimmed — the numbers are real, just not current. */}
      <div className={trusted ? undefined : "opacity-40"}>
        {pm25 ? (
          <div className="mb-4 flex items-baseline gap-3">
            <span className="text-4xl font-semibold">
              {pm25.value.toFixed(1)}
            </span>
            <span className="text-sm text-neutral-500">µg/m³ PM2.5</span>
            {pm25.aqi !== null && (
              <span
                className="ml-auto rounded-full px-3 py-1 text-xs font-semibold text-white"
                style={{ backgroundColor: aqiColor(pm25.aqi) }}
              >
                AQI {pm25.aqi}
              </span>
            )}
          </div>
        ) : (
          <p className="mb-4 text-sm text-neutral-500">
            This device does not report PM2.5.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-3 text-sm">
          {others.map((r) => (
            <div key={r.metric} className="flex justify-between">
              <dt className="text-neutral-500">{METRIC_LABELS[r.metric]}</dt>
              <dd>
                {r.value.toFixed(decimals(r.metric))} {METRIC_UNITS[r.metric]}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {!trusted && (
        <p className="mt-4 border-t border-neutral-800 pt-3 text-xs text-amber-400/80">
          {device.online
            ? "This sensor is reporting its power-on frame (all zeros, CO₂ 511) rather than a measurement — it usually settles within a few minutes."
            : "Tuya reports this sensor as offline — the values above are its last known reading, not a current measurement."}
        </p>
      )}
    </div>
  );
}

function Comparison({ devices }: { devices: LiveDevice[] }) {
  // Only devices whose values are trustworthy may drive the headline number:
  // a booting sensor reading 0.0 would otherwise claim perfect filtration.
  const pm25 = (placement: string) =>
    devices
      .find((d) => d.placement === placement && d.online && d.reporting)
      ?.readings.find((r) => r.metric === Metric.PM25);

  const indoor = pm25("indoor");
  const outdoor = pm25("outdoor");
  if (!indoor || !outdoor || outdoor.value <= 0) return null;

  const reduction = ((outdoor.value - indoor.value) / outdoor.value) * 100;

  return (
    <div className="print-card print-break-inside-avoid mb-8 rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-2 text-sm font-medium text-neutral-400">
        Indoor vs outdoor — PM2.5
      </h2>
      <p className="text-3xl font-semibold tabular-nums">
        {reduction > 0 ? "−" : "+"}
        {Math.abs(reduction).toFixed(1)}%
        <span className="ml-2 text-sm font-normal text-neutral-500">
          {reduction > 0 ? "lower indoors" : "higher indoors"}
        </span>
      </p>
    </div>
  );
}

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

  // Indoor first, then outdoor, then anything unplaced — the comparison the
  // rig exists to make, read left to right.
  const order = { indoor: 0, outdoor: 1 } as const;
  const sorted = [...devices].sort(
    (a, b) =>
      (a.placement ? order[a.placement] : 2) -
      (b.placement ? order[b.placement] : 2),
  );

  // History is a paginated call per device, so only charted devices pay for it.
  // Cached for 5 minutes inside tuya-public, independent of this page's 60s.
  const charted = sorted.filter((d) => d.placement !== null);
  const series: TrendSeries[] = await Promise.all(
    charted.map(async (device, i) => ({
      id: device.id,
      label: device.label,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      points: await fetchRecentPm25(device.id),
    })),
  );

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

      <Comparison devices={sorted} />

      <div className="print-card print-break-inside-avoid mb-8 rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-3 text-sm font-medium text-neutral-400">
          PM2.5 — last {HISTORY_WINDOW_HOURS}h
        </h2>
        <TrendChart series={series} windowHours={HISTORY_WINDOW_HOURS} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {sorted.map((device) => (
          <DeviceCard key={device.id} device={device} />
        ))}
      </div>

      {/* Print only: on screen the mark already sits in the nav bar, which is
          hidden on paper. Normal flow, so it lands once on the last page. */}
      <footer className="print-footer mt-10 hidden items-end justify-between border-t border-neutral-300 pt-4 print:flex">
        <p className="text-[10px] leading-relaxed text-neutral-500">
          PM2.5 in raw µg/m³; AQI per US EPA breakpoints. Live values read from
          the Tuya cloud — this page keeps no history of its own.
        </p>
        <div className="print-logo flex flex-col items-end gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Sure Solutions and Services" className="h-14 w-auto" />
          <p className="text-[10px] font-medium italic tracking-wide text-neutral-500">
            Think for a Better World
          </p>
        </div>
      </footer>

      {devices.length === 0 && (
        <p className="text-sm text-neutral-500">
          No devices are linked to this Tuya account.
        </p>
      )}
    </main>
  );
}
