"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { Metric, type DeviceDto, type ReadingResultDto } from "@tuya-dashboard/shared";
import { api } from "../../lib/api";
import { mergeSeries } from "../../lib/series";
import { METRIC_LABELS, METRIC_UNITS } from "../../lib/metric-labels";
import {
  aqiFor,
  formatValue,
  reductionPct,
  summarise,
  todayWindow,
  type MetricSummary,
} from "../../lib/report-stats";

// Fixed rather than responsive: ResponsiveContainer measures its box on screen,
// and the print layout re-measures to a different width mid-render. A fixed
// size is what actually survives the print pipeline.
//
// A4 is 210mm wide; at 14mm side margins that leaves 182mm ≈ 688px at 96dpi,
// so the chart stays under that or the browser silently rescales the page.
const CHART_WIDTH = 660;
const CHART_HEIGHT = 260;

const SERIES_COLORS = { a: "#16a34a", b: "#2563eb" };

const METRIC_ORDER: Metric[] = [
  Metric.PM25,
  Metric.CO2,
  Metric.TEMPERATURE,
  Metric.HUMIDITY,
  Metric.VOC,
  Metric.CH2O,
];

interface DeviceReport {
  device: DeviceDto;
  summaries: MetricSummary[];
  pm25: ReadingResultDto[];
}

function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function StatTable({ summaries }: { summaries: MetricSummary[] }) {
  if (summaries.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No readings recorded today for this device.
      </p>
    );
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-neutral-300 text-left text-xs uppercase tracking-wide text-neutral-500">
          <th className="py-1.5 font-medium">Metric</th>
          <th className="py-1.5 text-right font-medium">Min</th>
          <th className="py-1.5 text-right font-medium">Mean</th>
          <th className="py-1.5 text-right font-medium">Max</th>
          <th className="py-1.5 text-right font-medium">Current</th>
          <th className="py-1.5 text-right font-medium">n</th>
        </tr>
      </thead>
      <tbody>
        {summaries.map((s) => (
          <tr key={s.metric} className="border-b border-neutral-200 last:border-0">
            <td className="py-1.5">
              {METRIC_LABELS[s.metric]}
              {METRIC_UNITS[s.metric] && (
                <span className="text-neutral-500"> ({METRIC_UNITS[s.metric]})</span>
              )}
            </td>
            <td className="py-1.5 text-right tabular-nums">
              {formatValue(s.metric, s.min)}
            </td>
            <td className="py-1.5 text-right font-medium tabular-nums">
              {formatValue(s.metric, s.mean)}
            </td>
            <td className="py-1.5 text-right tabular-nums">
              {formatValue(s.metric, s.max)}
            </td>
            <td className="py-1.5 text-right tabular-nums">
              {formatValue(s.metric, s.current)}
            </td>
            <td className="py-1.5 text-right tabular-nums text-neutral-500">{s.n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Comparison({ reports }: { reports: DeviceReport[] }) {
  const indoor = reports.find((r) => r.device.placement === "indoor");
  const outdoor = reports.find((r) => r.device.placement === "outdoor");

  const indoorPm = indoor?.summaries.find((s) => s.metric === Metric.PM25);
  const outdoorPm = outdoor?.summaries.find((s) => s.metric === Metric.PM25);

  if (!indoorPm || !outdoorPm) {
    const present = [indoorPm && "indoor", outdoorPm && "outdoor"]
      .filter(Boolean)
      .join(" and ");
    return (
      <p className="text-sm text-neutral-500">
        Needs today&apos;s PM2.5 from both an indoor and an outdoor device; only{" "}
        {present || "neither"} reported.
      </p>
    );
  }

  const reduction = reductionPct(indoorPm.mean, outdoorPm.mean);

  return (
    <div className="grid grid-cols-3 gap-4">
      {[
        { label: "Indoor mean", device: indoor!.device, summary: indoorPm },
        { label: "Outdoor mean", device: outdoor!.device, summary: outdoorPm },
      ].map(({ label, device, summary }) => {
        const aqi = aqiFor(Metric.PM25, summary.mean);
        return (
          <div key={label} className="rounded border border-neutral-300 p-3">
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              {label}
            </div>
            {/* Named explicitly: with more than one device at a placement, the
                comparison would otherwise silently pick one of them. */}
            <div className="truncate text-xs text-neutral-400">{device.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {formatValue(Metric.PM25, summary.mean)}
              <span className="ml-1 text-sm font-normal text-neutral-500">
                µg/m³
              </span>
            </div>
            {aqi !== null && <div className="text-xs text-neutral-500">AQI {aqi}</div>}
          </div>
        );
      })}

      <div className="rounded border border-neutral-900 bg-neutral-900 p-3 text-white">
        <div className="text-xs uppercase tracking-wide text-neutral-300">
          Indoor vs outdoor
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">
          {reduction === null
            ? "—"
            : `${reduction > 0 ? "-" : "+"}${Math.abs(reduction).toFixed(1)}%`}
        </div>
        <div className="text-xs text-neutral-300">
          {reduction === null
            ? "outdoor mean is zero"
            : reduction > 0
              ? "lower indoors"
              : "higher indoors"}
        </div>
      </div>
    </div>
  );
}

export default function ReportPage() {
  const devicesQuery = useQuery({ queryKey: ["devices"], queryFn: api.listDevices });
  const devices = devicesQuery.data;

  const reportQuery = useQuery({
    queryKey: ["report", "today", devices?.map((d) => d.id).join(",")],
    enabled: Boolean(devices?.length),
    queryFn: async (): Promise<{ generatedAt: number; reports: DeviceReport[] }> => {
      const { from, to } = todayWindow();

      const reports = await Promise.all(
        (devices ?? []).map(async (device) => {
          const series = await Promise.all(
            METRIC_ORDER.map((metric) =>
              api.readings({ deviceId: device.id, metric, from, to }),
            ),
          );

          const summaries = METRIC_ORDER.map((metric, i) =>
            summarise(metric, series[i]),
          ).filter((s): s is MetricSummary => s !== null);

          return {
            device,
            summaries,
            pm25: series[METRIC_ORDER.indexOf(Metric.PM25)],
          };
        }),
      );

      return { generatedAt: Date.now(), reports };
    },
  });

  if (devicesQuery.isLoading || reportQuery.isLoading) {
    return <main className="p-8 text-neutral-400">Building today&apos;s report…</main>;
  }

  if (devicesQuery.isError || reportQuery.isError) {
    const error = devicesQuery.error ?? reportQuery.error;
    return (
      <main className="p-8">
        <p className="text-red-400">
          Could not build the report: {(error as Error)?.message ?? "unknown error"}
        </p>
      </main>
    );
  }

  const reports = reportQuery.data?.reports ?? [];
  const generatedAt = reportQuery.data?.generatedAt ?? Date.now();
  const { from } = todayWindow(new Date(generatedAt));

  const indoor = reports.find((r) => r.device.placement === "indoor");
  const outdoor = reports.find((r) => r.device.placement === "outdoor");
  const chartData = mergeSeries(indoor?.pm25 ?? [], outdoor?.pm25 ?? []);

  const totalReadings = reports.reduce(
    (sum, r) => sum + r.summaries.reduce((n, s) => n + s.n, 0),
    0,
  );

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="print-hide mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Today&apos;s report</h1>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          Export PDF
        </button>
      </div>

      {/* The sheet is white on screen too, so what you see is what prints. */}
      <article className="print-sheet rounded-lg bg-white p-10 text-neutral-900 shadow-lg">
        <header className="mb-8 border-b border-neutral-300 pb-4">
          <h2 className="text-2xl font-semibold">Air Quality Report</h2>
          <p className="mt-1 text-sm text-neutral-600">
            {new Date(from).toLocaleDateString([], {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
          <p className="text-xs text-neutral-500">
            Generated {new Date(generatedAt).toLocaleString()} · midnight to now ·{" "}
            {totalReadings.toLocaleString()} readings
          </p>
        </header>

        {totalReadings === 0 ? (
          <p className="text-sm text-neutral-600">
            No readings were recorded today, so there is nothing to report. This is a
            real gap in the data, not a formatting problem — check that the backend
            poller is running.
          </p>
        ) : (
          <>
            <section className="print-break-inside-avoid mb-8">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Indoor vs outdoor — PM2.5
              </h3>
              <Comparison reports={reports} />
            </section>

            <section className="print-break-inside-avoid mb-8">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                PM2.5 today
              </h3>
              <LineChart
                width={CHART_WIDTH}
                height={CHART_HEIGHT}
                data={chartData}
                margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
              >
                <CartesianGrid stroke="#e5e5e5" strokeDasharray="3 3" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={formatClock}
                  stroke="#525252"
                  fontSize={11}
                />
                <YAxis
                  stroke="#525252"
                  fontSize={11}
                  unit={` ${METRIC_UNITS[Metric.PM25]}`}
                  width={70}
                />
                <Legend />
                {indoor && (
                  <Line
                    type="monotone"
                    dataKey="a"
                    name={indoor.device.label}
                    stroke={SERIES_COLORS.a}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {outdoor && (
                  <Line
                    type="monotone"
                    dataKey="b"
                    name={outdoor.device.label}
                    stroke={SERIES_COLORS.b}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </section>

            {reports.map((report) => (
              <section
                key={report.device.id}
                className="print-break-inside-avoid mb-8 last:mb-0"
              >
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                  {report.device.label}
                  <span className="ml-2 font-normal normal-case tracking-normal text-neutral-400">
                    {report.device.placement}
                    {report.device.groupName ? ` · ${report.device.groupName}` : ""}
                  </span>
                </h3>
                <StatTable summaries={report.summaries} />
              </section>
            ))}
          </>
        )}

        <footer className="mt-10 flex items-end justify-between border-t border-neutral-200 pt-4">
          <p className="text-[10px] leading-relaxed text-neutral-400">
            PM2.5 stored as raw µg/m³; AQI computed per US EPA breakpoints.
            <br />
            Statistics cover only readings actually recorded — gaps are not
            interpolated.
          </p>
          {/* Brand block: the mark sits bottom-right of every printed page, with
              the slogan under it. display:none rather than visibility:hidden on
              a missing logo, so the slogan closes the gap instead of floating. */}
          <div className="print-logo flex flex-col items-end gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Sure Solutions and Services"
              className="h-14 w-auto"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <p className="text-[10px] font-medium italic tracking-wide text-neutral-500">
              Think for a Better World
            </p>
          </div>
        </footer>
      </article>
    </main>
  );
}
