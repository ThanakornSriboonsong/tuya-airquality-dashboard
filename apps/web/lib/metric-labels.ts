import { Metric } from "@tuya-dashboard/shared";

export const METRIC_LABELS: Record<Metric, string> = {
  [Metric.PM25]: "PM2.5",
  [Metric.PM10]: "PM10",
  [Metric.CO2]: "CO₂",
  [Metric.TEMPERATURE]: "Temperature",
  [Metric.HUMIDITY]: "Humidity",
  [Metric.VOC]: "VOC",
  [Metric.CH2O]: "Formaldehyde",
  [Metric.FAN_SPEED]: "Fan speed",
};

export const METRIC_UNITS: Record<Metric, string> = {
  [Metric.PM25]: "µg/m³",
  [Metric.PM10]: "µg/m³",
  [Metric.CO2]: "ppm",
  [Metric.TEMPERATURE]: "°C",
  [Metric.HUMIDITY]: "%",
  [Metric.VOC]: "mg/m³",
  [Metric.CH2O]: "mg/m³",
  [Metric.FAN_SPEED]: "",
};
