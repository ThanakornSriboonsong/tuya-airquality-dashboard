// Canonical internal metric names. Tuya DP codes vary per device model and are
// mapped to these via the `device_metrics` table — never hardcoded here.
export enum Metric {
  PM25 = "pm25",
  PM10 = "pm10",
  CO2 = "co2",
  TEMPERATURE = "temperature",
  HUMIDITY = "humidity",
  VOC = "voc",
  CH2O = "ch2o",
  FAN_SPEED = "fan_speed",
}

export type Placement = "indoor" | "outdoor";

export type RunCondition = "purifier_on" | "purifier_off_control" | "passive";
