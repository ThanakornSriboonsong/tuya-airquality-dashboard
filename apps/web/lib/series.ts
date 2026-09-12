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
