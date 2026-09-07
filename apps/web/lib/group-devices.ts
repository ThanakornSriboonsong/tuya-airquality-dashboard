import type { DeviceDto } from "@tuya-dashboard/shared";

export const UNGROUPED = "Ungrouped";

/** Buckets devices by `groupName`, named groups A–Z first and ungrouped last. */
export function groupDevices<T extends Pick<DeviceDto, "groupName" | "label">>(
  devices: T[],
): Array<{ name: string; devices: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const device of devices) {
    const key = device.groupName ?? UNGROUPED;
    const list = buckets.get(key) ?? [];
    list.push(device);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return a.localeCompare(b);
    })
    .map(([name, list]) => ({
      name,
      devices: [...list].sort((a, b) => a.label.localeCompare(b.label)),
    }));
}
