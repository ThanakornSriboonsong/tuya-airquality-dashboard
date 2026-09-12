"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Metric,
  type DeviceDto,
  type LatestReadingDto,
} from "@tuya-dashboard/shared";
import { api } from "../lib/api";
import { aqiColor } from "../lib/aqi-color";
import { groupDevices } from "../lib/group-devices";
import { mergeSeries } from "../lib/series";
import { METRIC_LABELS, METRIC_UNITS } from "../lib/metric-labels";

const HOURS_OF_HISTORY = 24;
const COMPARE_STORAGE_KEY = "dashboard.compare";
const SERIES_COLORS = { a: "#22c55e", b: "#3b82f6" };

type Comparison = { a: string | null; b: string | null; metric: Metric };

const ALL_METRICS = Object.keys(METRIC_LABELS) as Metric[];

function readStoredComparison(devices: DeviceDto[]): Comparison | null {
  try {
    const raw = window.localStorage.getItem(COMPARE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Comparison;
    const exists = (id: string | null) =>
      id === null ? null : devices.some((d) => d.id === id) ? id : null;
    return {
      a: exists(parsed.a),
      b: exists(parsed.b),
      metric: ALL_METRICS.includes(parsed.metric) ? parsed.metric : Metric.PM25,
    };
  } catch {
    return null;
  }
}

/** Falls back to the first indoor/outdoor pair, which is the usual rig setup. */
function defaultComparison(devices: DeviceDto[]): Comparison {
  const indoor = devices.find((d) => d.placement === "indoor");
  const outdoor = devices.find((d) => d.placement === "outdoor");
  const rest = devices.filter((d) => d.id !== indoor?.id && d.id !== outdoor?.id);
  return {
    a: indoor?.id ?? rest[0]?.id ?? null,
    b: outdoor?.id ?? rest.find((d) => d.id !== rest[0]?.id)?.id ?? null,
    metric: Metric.PM25,
  };
}

function DeviceSelect({
  label,
  value,
  devices,
  color,
  onChange,
}: {
  label: string;
  value: string | null;
  devices: DeviceDto[];
  color: string;
  onChange: (id: string | null) => void;
}) {
  const groups = groupDevices(devices);

  return (
    <label className="flex flex-col text-xs text-neutral-400">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
      >
        <option value="">— none —</option>
        {groups.map((group) => (
          <optgroup key={group.name} label={group.name}>
            {group.devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} ({d.placement})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function MetricSelect({
  value,
  options,
  onChange,
}: {
  value: Metric;
  options: Metric[];
  onChange: (metric: Metric) => void;
}) {
  return (
    <label className="flex flex-col text-xs text-neutral-400">
      Metric
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Metric)}
        className="mt-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
      >
        {options.map((m) => (
          <option key={m} value={m}>
            {METRIC_LABELS[m]}
            {METRIC_UNITS[m] ? ` (${METRIC_UNITS[m]})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function DeviceCard({
  label,
  groupName,
  readings,
}: {
  label: string;
  groupName: string | null;
  readings: LatestReadingDto[];
}) {
  const pm25 = readings.find((r) => r.metric === Metric.PM25);
  const others = readings.filter((r) => r.metric !== Metric.PM25);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-medium text-neutral-400">{label}</h3>
        {groupName && (
          <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-500">
            {groupName}
          </span>
        )}
      </div>
      {pm25 && (
        <div className="mb-4 flex items-baseline gap-3">
          <span className="text-4xl font-semibold">{pm25.value.toFixed(1)}</span>
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
      )}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {others.map((r) => (
          <div key={r.metric} className="flex justify-between">
            <dt className="text-neutral-500">{METRIC_LABELS[r.metric]}</dt>
            <dd>
              {r.value.toFixed(r.metric === Metric.VOC || r.metric === Metric.CH2O ? 3 : 1)}{" "}
              {METRIC_UNITS[r.metric]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function Dashboard() {
  const latestQuery = useQuery({
    queryKey: ["readings", "latest"],
    queryFn: api.latestReadings,
    refetchInterval: 30_000,
  });

  const devicesQuery = useQuery({ queryKey: ["devices"], queryFn: api.listDevices });
  const devices = devicesQuery.data;

  const [comparison, setComparison] = useState<Comparison | null>(null);

  // Restore the saved pair once devices are known, so ids that no longer exist
  // fall back to the default rather than silently charting nothing.
  useEffect(() => {
    if (!devices || comparison) return;
    const stored = readStoredComparison(devices);
    setComparison(stored?.a || stored?.b ? stored : defaultComparison(devices));
  }, [devices, comparison]);

  const selectComparison = (next: Comparison) => {
    setComparison(next);
    window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(next));
  };

  const deviceA = devices?.find((d) => d.id === comparison?.a);
  const deviceB = devices?.find((d) => d.id === comparison?.b);
  const metric = comparison?.metric ?? Metric.PM25;

  const historyQuery = useQuery({
    queryKey: ["history", metric, deviceA?.id, deviceB?.id],
    enabled: Boolean(deviceA || deviceB),
    queryFn: async () => {
      const from = Date.now() - HOURS_OF_HISTORY * 60 * 60 * 1000;
      const [a, b] = await Promise.all([
        deviceA
          ? api.readings({ deviceId: deviceA.id, metric, from })
          : Promise.resolve([]),
        deviceB
          ? api.readings({ deviceId: deviceB.id, metric, from })
          : Promise.resolve([]),
      ]);
      return mergeSeries(a, b);
    },
  });

  if (devicesQuery.data?.length === 0) {
    return (
      <main className="p-8">
        <p className="text-neutral-400">
          No devices registered yet. Go to{" "}
          <a href="/devices" className="underline">
            Devices
          </a>{" "}
          to add one from your Tuya account.
        </p>
      </main>
    );
  }

  const byDevice = new Map<string, LatestReadingDto[]>();
  for (const r of latestQuery.data ?? []) {
    const list = byDevice.get(r.deviceId) ?? [];
    list.push(r);
    byDevice.set(r.deviceId, list);
  }

  // One flat grid so any two cards stay side by side; grouping shows as a chip
  // and only clusters the order.
  const orderedDevices = groupDevices(devices ?? []).flatMap((g) => g.devices);

  // Offer only metrics the compared devices actually report, so the picker can't
  // select a series that will always be empty. The current choice stays listed
  // even if it drops out, otherwise the select would render blank.
  const reported = new Set(
    (latestQuery.data ?? [])
      .filter((r) => r.deviceId === deviceA?.id || r.deviceId === deviceB?.id)
      .map((r) => r.metric),
  );
  const available = ALL_METRICS.filter((m) => reported.has(m));
  const metricOptions = available.length === 0 ? ALL_METRICS : available;
  if (!metricOptions.includes(metric)) metricOptions.unshift(metric);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Air Quality</h1>
        <Link
          href="/report"
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
        >
          Export today&apos;s report
        </Link>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {orderedDevices.map((device) => (
          <DeviceCard
            key={device.id}
            label={device.label}
            groupName={device.groupName}
            readings={byDevice.get(device.id) ?? []}
          />
        ))}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-sm font-medium text-neutral-400">
            {METRIC_LABELS[metric]} — last {HOURS_OF_HISTORY}h
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <MetricSelect
              value={metric}
              options={metricOptions}
              onChange={(m) =>
                selectComparison({
                  a: comparison?.a ?? null,
                  b: comparison?.b ?? null,
                  metric: m,
                })
              }
            />
            <DeviceSelect
              label="Compare"
              value={comparison?.a ?? null}
              devices={devices ?? []}
              color={SERIES_COLORS.a}
              onChange={(id) =>
                selectComparison({ a: id, b: comparison?.b ?? null, metric })
              }
            />
            <DeviceSelect
              label="Against"
              value={comparison?.b ?? null}
              devices={devices ?? []}
              color={SERIES_COLORS.b}
              onChange={(id) =>
                selectComparison({ a: comparison?.a ?? null, b: id, metric })
              }
            />
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historyQuery.data ?? []}>
              <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
              <XAxis
                dataKey="ts"
                tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                stroke="#737373"
                fontSize={12}
              />
              <YAxis
                stroke="#737373"
                fontSize={12}
                unit={METRIC_UNITS[metric] ? ` ${METRIC_UNITS[metric]}` : ""}
                width={70}
              />
              <Tooltip
                labelFormatter={(ts) => new Date(ts as number).toLocaleString()}
                contentStyle={{ background: "#171717", border: "1px solid #262626" }}
              />
              <Legend />
              {deviceA && (
                <Line
                  type="monotone"
                  dataKey="a"
                  name={deviceA.label}
                  stroke={SERIES_COLORS.a}
                  dot={false}
                  connectNulls
                />
              )}
              {deviceB && (
                <Line
                  type="monotone"
                  dataKey="b"
                  name={deviceB.label}
                  stroke={SERIES_COLORS.b}
                  dot={false}
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </main>
  );
}
