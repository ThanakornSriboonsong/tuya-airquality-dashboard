"use client";

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
import { Metric, type LatestReadingDto, type ReadingResultDto } from "@tuya-dashboard/shared";
import { api } from "../lib/api";
import { aqiColor } from "../lib/aqi-color";
import { METRIC_LABELS, METRIC_UNITS } from "../lib/metric-labels";

const HOURS_OF_HISTORY = 24;

function mergeSeries(indoor: ReadingResultDto[], outdoor: ReadingResultDto[]) {
  const map = new Map<number, { ts: number; indoor?: number; outdoor?: number }>();
  for (const r of indoor) map.set(r.ts, { ...map.get(r.ts), ts: r.ts, indoor: r.value });
  for (const r of outdoor) map.set(r.ts, { ...map.get(r.ts), ts: r.ts, outdoor: r.value });
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

function DeviceCard({ label, readings }: { label: string; readings: LatestReadingDto[] }) {
  const pm25 = readings.find((r) => r.metric === Metric.PM25);
  const others = readings.filter((r) => r.metric !== Metric.PM25);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h3 className="mb-3 text-sm font-medium text-neutral-400">{label}</h3>
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

  const indoorDevice = devicesQuery.data?.find((d) => d.placement === "indoor");
  const outdoorDevice = devicesQuery.data?.find((d) => d.placement === "outdoor");

  const historyQuery = useQuery({
    queryKey: ["pm25-history", indoorDevice?.id, outdoorDevice?.id],
    enabled: Boolean(indoorDevice || outdoorDevice),
    queryFn: async () => {
      const from = Date.now() - HOURS_OF_HISTORY * 60 * 60 * 1000;
      const [indoor, outdoor] = await Promise.all([
        indoorDevice
          ? api.readings({ deviceId: indoorDevice.id, metric: Metric.PM25, from })
          : Promise.resolve([]),
        outdoorDevice
          ? api.readings({ deviceId: outdoorDevice.id, metric: Metric.PM25, from })
          : Promise.resolve([]),
      ]);
      return mergeSeries(indoor, outdoor);
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

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="mb-6 text-xl font-semibold">Indoor vs Outdoor Air Quality</h1>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[...byDevice.entries()].map(([deviceId, readings]) => (
          <DeviceCard key={deviceId} label={readings[0]?.label ?? deviceId} readings={readings} />
        ))}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">
          PM2.5 — last {HOURS_OF_HISTORY}h
        </h2>
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
              <YAxis stroke="#737373" fontSize={12} unit=" µg/m³" />
              <Tooltip
                labelFormatter={(ts) => new Date(ts as number).toLocaleString()}
                contentStyle={{ background: "#171717", border: "1px solid #262626" }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="indoor"
                name="Indoor"
                stroke="#22c55e"
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="outdoor"
                name="Outdoor"
                stroke="#3b82f6"
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </main>
  );
}
