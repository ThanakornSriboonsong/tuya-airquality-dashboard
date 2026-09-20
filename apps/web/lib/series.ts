import type { ReadingResultDto } from "@tuya-dashboard/shared";

export interface MergedPoint {
  ts: number;
  a?: number;
  b?: number;
}

/**
 * Interleaves two device series onto a shared time axis.
 *
 * The two sensors report independently, so their timestamps rarely line up.
 * Points keep their own timestamp rather than being bucketed — the chart
 * connects across the holes, but nothing is resampled or averaged into a
 * value the device never reported.
 */
export function mergeSeries(
  a: ReadingResultDto[],
  b: ReadingResultDto[],
): MergedPoint[] {
  const map = new Map<number, MergedPoint>();
  for (const r of a) map.set(r.ts, { ...map.get(r.ts), ts: r.ts, a: r.value });
  for (const r of b) map.set(r.ts, { ...map.get(r.ts), ts: r.ts, b: r.value });
  return [...map.values()].sort((x, y) => x.ts - y.ts);
}

export interface TimePoint {
  ts: number;
  value: number;
}

/**
 * Thins a series to at most `maxPoints` by averaging within equal time buckets.
 *
 * A day of CO₂ is ~5,950 readings per device; sending three of those to a
 * browser is about a megabyte of JSON and a chart that stutters while panning.
 * The eye cannot resolve more than a pixel-per-point anyway.
 *
 * This is for drawing only. Statistics must be computed from the raw readings —
 * a bucketed mean is a derived number, and min/max in particular would be
 * flattened by it, understating exactly the pollution spikes the rig exists to
 * catch. Bucket timestamps are the mean of the readings inside, so a point is
 * never placed at a time when nothing was reported.
 */
export function downsample(points: TimePoint[], maxPoints: number): TimePoint[] {
  if (points.length <= maxPoints || maxPoints < 1) return points;

  const first = points[0].ts;
  const last = points[points.length - 1].ts;
  const span = last - first;
  if (span <= 0) return points;

  const bucketMs = span / maxPoints;
  const out: TimePoint[] = [];

  let bucketIndex = -1;
  let tsTotal = 0;
  let valueTotal = 0;
  let count = 0;

  const flush = () => {
    if (count > 0) out.push({ ts: Math.round(tsTotal / count), value: valueTotal / count });
  };

  for (const point of points) {
    const index = Math.floor((point.ts - first) / bucketMs);
    if (index !== bucketIndex) {
      flush();
      bucketIndex = index;
      tsTotal = 0;
      valueTotal = 0;
      count = 0;
    }
    tsTotal += point.ts;
    valueTotal += point.value;
    count++;
  }
  flush();

  return out;
}
