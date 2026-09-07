import type { Metric, Placement, RunCondition } from "./metrics";

export interface DeviceDto {
  id: string;
  label: string;
  placement: Placement;
  // Free-form organisational grouping (e.g. "Bedroom", "Rig A"). Independent of
  // `placement`, which stays the physical indoor/outdoor fact the analysis needs.
  groupName: string | null;
  roomVolumeM3: number | null;
}

export interface DeviceMetricDto {
  deviceId: string;
  dpCode: string;
  metric: Metric;
  unit: string;
  scale: number;
}

export interface ReadingDto {
  ts: number;
  deviceId: string;
  metric: Metric;
  value: number;
}

// A reading after scale + calibration have been applied at read time (see
// hard rule 2). `aqi` is present only for pm25 readings.
export interface ReadingResultDto extends ReadingDto {
  aqi: number | null;
}

export interface LatestReadingDto extends ReadingResultDto {
  placement: Placement;
  label: string;
}

export interface CalibrationDto {
  deviceId: string;
  metric: Metric;
  slope: number;
  intercept: number;
  fittedAt: number;
  validFrom: number;
}

export interface RunDto {
  id: string;
  label: string;
  startedAt: number;
  endedAt: number | null;
  condition: RunCondition;
  fanSpeed: string | null;
  notes: string | null;
}

// Result of querying a Tuya device's /specifications endpoint during discovery.
export interface TuyaDeviceSpecDto {
  deviceId: string;
  name: string;
  category: string;
  dataPoints: Array<{
    dpCode: string;
    dpType: string;
    values: string;
  }>;
}

// A device found in the Tuya account, alongside whether it's already
// registered locally (so the UI can offer "Add" only for the new ones).
export interface DiscoveredDeviceDto extends TuyaDeviceSpecDto {
  isRegistered: boolean;
}

export interface RegisterDeviceRequest {
  deviceId: string;
  label: string;
  placement: Placement;
  groupName: string | null;
  roomVolumeM3: number | null;
}

// Every field optional — only the keys present are written.
export interface UpdateDeviceRequest {
  label?: string;
  placement?: Placement;
  groupName?: string | null;
  roomVolumeM3?: number | null;
}

export interface RegisterDeviceResponse {
  device: DeviceDto;
  mappedMetrics: DeviceMetricDto[];
  unmappedDpCodes: string[];
}
