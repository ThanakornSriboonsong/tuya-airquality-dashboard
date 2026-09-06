// US EPA AQI category colors, matching the breakpoints in packages/shared/src/aqi.ts.
export function aqiColor(aqi: number | null): string {
  if (aqi === null) return "#6b7280"; // gray-500, unknown
  if (aqi <= 50) return "#22c55e"; // green-500, Good
  if (aqi <= 100) return "#eab308"; // yellow-500, Moderate
  if (aqi <= 150) return "#f97316"; // orange-500, Unhealthy for Sensitive Groups
  if (aqi <= 200) return "#ef4444"; // red-500, Unhealthy
  if (aqi <= 300) return "#a855f7"; // purple-500, Very Unhealthy
  return "#7f1d1d"; // red-900, Hazardous
}
