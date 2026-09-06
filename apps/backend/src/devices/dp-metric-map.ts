import { Metric } from "@tuya-dashboard/shared";

/**
 * The single place that teaches the system a Tuya DP code. Different sensor
 * models name the same physical quantity differently (e.g. `temp_current`
 * vs `va_temperature`), so onboarding a new device model is usually just
 * adding a line here — everything downstream (registration, poller, API)
 * reads `device_metrics`, never this map directly.
 */
export const KNOWN_DP_METRIC_MAP: Record<string, Metric> = {
  pm25_value: Metric.PM25,
  pm10_value: Metric.PM10,
  co2_value: Metric.CO2,
  temp_current: Metric.TEMPERATURE,
  va_temperature: Metric.TEMPERATURE,
  humidity_value: Metric.HUMIDITY,
  va_humidity: Metric.HUMIDITY,
  voc_value: Metric.VOC,
  ch2o_value: Metric.CH2O,
  fan_speed_enum: Metric.FAN_SPEED,
};

export interface ParsedDpValues {
  unit: string;
  scale: number;
}

/** Tuya's `values` field is a JSON string; shape varies by dpType. */
export function parseDpValues(raw: string): ParsedDpValues {
  try {
    const parsed = JSON.parse(raw);
    return {
      unit: typeof parsed.unit === "string" ? parsed.unit : "",
      scale: typeof parsed.scale === "number" ? parsed.scale : 0,
    };
  } catch {
    return { unit: "", scale: 0 };
  }
}
