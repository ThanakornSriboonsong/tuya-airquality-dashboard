"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

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

function Chart({ series, print }: { series: TrendSeries[]; print: boolean }) {
  const data = mergeSeries(series);

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
        unit=" µg/m³"
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
  series,
  windowHours,
}: {
  series: TrendSeries[];
  windowHours: number;
}) {
  const hasData = series.some((s) => s.points.length > 0);

  if (!hasData) {
    return (
      <p className="text-sm text-neutral-500">
        No PM2.5 history in the last {windowHours} hours. Tuya keeps about seven
        days of device logs; a gap here means the sensors were not reporting.
      </p>
    );
  }

  return (
    <>
      {/* Screen: responsive, dark. */}
      <div className="print-hide h-64">
        <ResponsiveContainer width="100%" height="100%">
          <Chart series={series} print={false} />
        </ResponsiveContainer>
      </div>

      {/* Print: fixed size and light colours. ResponsiveContainer re-measures
          to a different width mid-print, which is how charts end up clipped. */}
      <div className="hidden print:block">
        <Chart series={series} print />
      </div>
    </>
  );
}
