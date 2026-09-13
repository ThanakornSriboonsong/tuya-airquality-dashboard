"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { Metric } from "@tuya-dashboard/shared";
import { METRIC_LABELS, METRIC_UNITS } from "../../lib/metric-labels";

export interface TrendSeries {
  id: string;
  label: string;
  color: string;
  points: Array<{ ts: number; value: number }>;
}

// Fixed width for print, responsive on screen — the same split the report page
// uses. A4 at 14mm margins leaves 182mm ≈ 688px, so the print size stays under it.
const PRINT_WIDTH = 660;
const HEIGHT = 260;

/**
 * One row per timestamp, with a column per device.
 *
 * The sensors report independently, so their timestamps rarely coincide —
 * rows stay sparse and the lines connect across the holes rather than
 * inventing a value at a time the device never reported.
 */
type ChartRow = Record<string, number>;

function mergeSeries(series: TrendSeries[]): ChartRow[] {
  const byTs = new Map<number, ChartRow>();
  for (const s of series) {
    for (const p of s.points) {
      const row = byTs.get(p.ts) ?? { ts: p.ts };
      row[s.id] = p.value;
      byTs.set(p.ts, row);
    }
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Chart({
  series,
  metric,
  print,
}: {
  series: TrendSeries[];
  metric: Metric;
  print: boolean;
}) {
  const data = mergeSeries(series);
  const unit = METRIC_UNITS[metric];

  return (
    <LineChart
      data={data}
      width={print ? PRINT_WIDTH : undefined}
      height={print ? HEIGHT : undefined}
      margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
    >
      <CartesianGrid stroke={print ? "#e5e5e5" : "#262626"} strokeDasharray="3 3" />
      <XAxis
        dataKey="ts"
        type="number"
        domain={["dataMin", "dataMax"]}
        tickFormatter={formatClock}
        stroke={print ? "#525252" : "#737373"}
        fontSize={11}
      />
      <YAxis
        stroke={print ? "#525252" : "#737373"}
        fontSize={11}
        unit={unit ? ` ${unit}` : ""}
        width={70}
      />
      <Legend />
      {series.map((s) => (
        <Line
          key={s.id}
          type="monotone"
          dataKey={s.id}
          name={s.label}
          stroke={s.color}
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
      ))}
    </LineChart>
  );
}

export function TrendChart({
  series: initialSeries,
  windowHours,
  availableMetrics,
  defaultMetric,
  colors,
}: {
  series: TrendSeries[];
  windowHours: number;
  /** Only metrics the sensors actually report — see the page component. */
  availableMetrics: Metric[];
  defaultMetric: Metric;
  colors: string[];
}) {
  const [metric, setMetric] = useState<Metric>(defaultMetric);
  const [series, setSeries] = useState<TrendSeries[]>(initialSeries);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The default metric is rendered on the server, so the first paint costs no
  // request; only an actual change fetches, and the server caches per metric.
  const choose = async (next: Metric) => {
    if (next === metric) return;
    setMetric(next);
    setError(null);

    if (next === defaultMetric) {
      setSeries(initialSeries);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/live/history?metric=${encodeURIComponent(next)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);

      setSeries(
        (body.series as Array<{ id: string; label: string; points: TrendSeries["points"] }>)
          .map((s, i) => ({ ...s, color: colors[i % colors.length] })),
      );
    } catch (e) {
      // Leave the previous chart up rather than blanking it; say what failed.
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const hasData = series.some((s) => s.points.length > 0);

  return (
    <>
      <div className="print-hide mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-neutral-400">
          Metric
          <select
            value={metric}
            onChange={(e) => void choose(e.target.value as Metric)}
            className="mt-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
          >
            {availableMetrics.map((m) => (
              <option key={m} value={m}>
                {METRIC_LABELS[m]}
                {METRIC_UNITS[m] ? ` (${METRIC_UNITS[m]})` : ""}
              </option>
            ))}
          </select>
        </label>
        {loading && <span className="text-xs text-neutral-500">Loading…</span>}
        {error && <span className="text-xs text-amber-400">{error}</span>}
      </div>

      {!hasData ? (
        <p className="text-sm text-neutral-500">
          No {METRIC_LABELS[metric]} history in the last {windowHours} hours.
          Tuya keeps about seven days of device logs; a gap here means the
          sensors were not reporting.
        </p>
      ) : (
        <>
          {/* Screen: responsive, dark. */}
          <div className="print-hide h-64">
            <ResponsiveContainer width="100%" height="100%">
              <Chart series={series} metric={metric} print={false} />
            </ResponsiveContainer>
          </div>

          {/* Print: fixed size and light colours. ResponsiveContainer
              re-measures to a different width mid-print, which is how charts
              end up clipped. */}
          <div className="hidden print:block">
            <Chart series={series} metric={metric} print />
          </div>
        </>
      )}
    </>
  );
}
