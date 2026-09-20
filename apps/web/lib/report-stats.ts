import { Metric, pm25ToAqi } from "@tuya-dashboard/shared";

/**
 * Summary of one metric over one window, for the printable report.
 *
 * Every field is derived from readings that actually exist — there is no
 * zero-filling and no carrying the last value forward across a gap. A window
 * with no readings summarises to `null` so the report can say "no data"
 * instead of printing a confident-looking 0.0 (see CLAUDE.md hard rule 5).
 */
export interface MetricSummary {
  metric: Metric;
  /** How many readings the mean/min/max are actually based on. */
  n: number;
  min: number;
  mean: number;
  max: number;
  current: number;
  currentTs: number;
}

/** Local midnight to now — "today" as the person reading the report means it. */
export function todayWindow(now: Date = new Date()): { from: number; to: number } {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return { from: midnight.getTime(), to: now.getTime() };
}

/**
 * Accepts anything carrying a timestamp and a value, so the rig's report (which
 * passes `ReadingResultDto` from its own database) and the public report (which
 * passes readings straight from the vendor API) share one implementation
 * instead of each growing its own statistics.
 */
export function summarise(
  metric: Metric,
  rows: Array<{ ts: number; value: number }>,
): MetricSummary | null {
  if (rows.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  let newest = rows[0];

  for (const row of rows) {
    if (row.value < min) min = row.value;
    if (row.value > max) max = row.value;
    total += row.value;
    if (row.ts > newest.ts) newest = row;
  }

  return {
    metric,
    n: rows.length,
    min,
    max,
    mean: total / rows.length,
    current: newest.value,
    currentTs: newest.ts,
  };
}

/**
 * How much lower indoor is than outdoor, as a percentage of outdoor.
 *
 * This is the headline number for "does the purifier work", so it stays
 * honest: a non-positive outdoor mean gives no meaningful ratio, and a
 * higher indoor reading yields a negative result rather than being clamped.
 */
export function reductionPct(
  indoorMean: number,
  outdoorMean: number,
): number | null {
  if (!Number.isFinite(indoorMean) || !Number.isFinite(outdoorMean)) return null;
  if (outdoorMean <= 0) return null;
  return ((outdoorMean - indoorMean) / outdoorMean) * 100;
}

/** VOC and formaldehyde arrive in mg/m³, where 1 decimal would hide the signal. */
export function decimalsFor(metric: Metric): number {
  return metric === Metric.VOC || metric === Metric.CH2O ? 3 : 1;
}

export function formatValue(metric: Metric, value: number): string {
  return value.toFixed(decimalsFor(metric));
}

/** AQI for a PM2.5 concentration; null for any other metric. */
export function aqiFor(metric: Metric, value: number): number | null {
  return metric === Metric.PM25 ? pm25ToAqi(value) : null;
}
