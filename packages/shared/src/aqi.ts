export interface AqiBreakpoint {
  concLow: number;
  concHigh: number;
  aqiLow: number;
  aqiHigh: number;
}

// US EPA PM2.5 breakpoints (24-hr average), post-2024 revision.
// Swap this table (or select a different one) to support other national
// standards without touching call sites.
export const US_EPA_PM25_BREAKPOINTS: AqiBreakpoint[] = [
  { concLow: 0.0, concHigh: 9.0, aqiLow: 0, aqiHigh: 50 },
  { concLow: 9.1, concHigh: 35.4, aqiLow: 51, aqiHigh: 100 },
  { concLow: 35.5, concHigh: 55.4, aqiLow: 101, aqiHigh: 150 },
  { concLow: 55.5, concHigh: 125.4, aqiLow: 151, aqiHigh: 200 },
  { concLow: 125.5, concHigh: 225.4, aqiLow: 201, aqiHigh: 300 },
  { concLow: 225.5, concHigh: 325.4, aqiLow: 301, aqiHigh: 500 },
];

export const AQI_STANDARD: AqiBreakpoint[] = US_EPA_PM25_BREAKPOINTS;

/** Linear interpolation of raw PM2.5 (µg/m³) to AQI using the given breakpoint table. */
export function pm25ToAqi(
  concentration: number,
  breakpoints: AqiBreakpoint[] = AQI_STANDARD,
): number | null {
  if (!Number.isFinite(concentration) || concentration < 0) return null;

  const bp = breakpoints.find(
    (b) => concentration >= b.concLow && concentration <= b.concHigh,
  );
  if (!bp) {
    // Above table range: clamp to the top bucket's AQI ceiling.
    const top = breakpoints[breakpoints.length - 1];
    return concentration > top.concHigh ? top.aqiHigh : null;
  }

  const { concLow, concHigh, aqiLow, aqiHigh } = bp;
  return Math.round(
    ((aqiHigh - aqiLow) / (concHigh - concLow)) * (concentration - concLow) +
      aqiLow,
  );
}
