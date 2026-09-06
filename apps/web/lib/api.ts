import type {
  DeviceDto,
  DiscoveredDeviceDto,
  LatestReadingDto,
  ReadingResultDto,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
} from "@tuya-dashboard/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listDevices: () => request<DeviceDto[]>("/devices"),
  discoverDevices: () => request<DiscoveredDeviceDto[]>("/devices/discover"),
  registerDevice: (body: RegisterDeviceRequest) =>
    request<RegisterDeviceResponse>("/devices", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  latestReadings: () => request<LatestReadingDto[]>("/readings/latest"),
  readings: (params: { deviceId?: string; metric?: string; from?: number; to?: number }) => {
    const qs = new URLSearchParams();
    if (params.deviceId) qs.set("deviceId", params.deviceId);
    if (params.metric) qs.set("metric", params.metric);
    if (params.from !== undefined) qs.set("from", String(params.from));
    if (params.to !== undefined) qs.set("to", String(params.to));
    return request<ReadingResultDto[]>(`/readings?${qs.toString()}`);
  },
};
