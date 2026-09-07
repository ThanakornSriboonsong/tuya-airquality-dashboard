import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import type {
  DeviceDto,
  DeviceMetricDto,
  DiscoveredDeviceDto,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  TuyaDeviceSpecDto,
  UpdateDeviceRequest,
} from "@tuya-dashboard/shared";
import { TuyaClientService } from "../tuya/tuya-client.service";
import { DB } from "../db/db.module";
import type { Db } from "../db/client";
import { devices, deviceMetrics } from "../db/schema";
import { KNOWN_DP_METRIC_MAP, parseDpValues } from "./dp-metric-map";

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  // tsx (esbuild) doesn't emit TS decorator metadata, so inject explicitly.
  constructor(
    @Inject(TuyaClientService) private readonly tuya: TuyaClientService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DB) private readonly db: Db,
  ) {}

  private async fetchSpec(
    deviceId: string,
    fallbackName: string,
    fallbackCategory: string,
  ): Promise<TuyaDeviceSpecDto> {
    const specResponse = await this.tuya.getDeviceSpecifications(deviceId);
    const result = specResponse.result;

    const dataPoints = [
      ...(result.functions ?? []),
      ...(result.status ?? []),
    ].map((dp) => ({
      dpCode: dp.code,
      dpType: dp.type,
      values: dp.values,
    }));

    return {
      deviceId,
      name: fallbackName,
      category: result.category ?? fallbackCategory,
      dataPoints,
    };
  }

  /** Every device in the linked Tuya app account, flagged with local registration status. */
  async discover(): Promise<DiscoveredDeviceDto[]> {
    const uid = this.config.get<string>("TUYA_UID");
    if (!uid) {
      throw new Error(
        "TUYA_UID is not set. Find it under Cloud > Devices > Link Tuya App " +
          "Account in the Tuya IoT Platform, then add it to .env.",
      );
    }

    const listResponse = await this.tuya.listDevicesForUser(uid);
    const tuyaDevices = listResponse.result ?? [];
    this.logger.log(`Found ${tuyaDevices.length} device(s) for uid ${uid}`);

    const registered = new Set(
      (await this.db.select({ id: devices.id }).from(devices)).map(
        (d) => d.id,
      ),
    );

    const specs: DiscoveredDeviceDto[] = [];
    for (const device of tuyaDevices) {
      const spec = await this.fetchSpec(device.id, device.name, device.category);
      specs.push({ ...spec, isRegistered: registered.has(device.id) });
    }

    return specs;
  }

  async getSpecification(deviceId: string): Promise<TuyaDeviceSpecDto> {
    return this.fetchSpec(deviceId, deviceId, "");
  }

  /**
   * Registers a device: fetches its live DP specification, maps recognized
   * codes to canonical metrics via KNOWN_DP_METRIC_MAP (unit/scale read from
   * the spec itself — never hardcoded), and upserts `devices` +
   * `device_metrics`. Unrecognized DP codes come back in the response so a
   * new sensor model can be added by extending the map, not by guessing.
   */
  async register(req: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
    const spec = await this.fetchSpec(req.deviceId, req.label, "");

    const mapped: DeviceMetricDto[] = [];
    const unmapped: string[] = [];
    const seen = new Set<string>();

    for (const dp of spec.dataPoints) {
      if (seen.has(dp.dpCode)) continue;
      seen.add(dp.dpCode);

      const metric = KNOWN_DP_METRIC_MAP[dp.dpCode];
      if (!metric) {
        unmapped.push(dp.dpCode);
        continue;
      }

      const { unit, scale } = parseDpValues(dp.values);
      mapped.push({ deviceId: req.deviceId, dpCode: dp.dpCode, metric, unit, scale });
    }

    await this.db
      .insert(devices)
      .values({
        id: req.deviceId,
        label: req.label,
        placement: req.placement,
        groupName: req.groupName,
        roomVolumeM3: req.roomVolumeM3,
      })
      .onConflictDoUpdate({
        target: devices.id,
        set: {
          label: req.label,
          placement: req.placement,
          groupName: req.groupName,
          roomVolumeM3: req.roomVolumeM3,
        },
      });

    await this.db.delete(deviceMetrics).where(eq(deviceMetrics.deviceId, req.deviceId));
    if (mapped.length > 0) {
      await this.db.insert(deviceMetrics).values(
        mapped.map((m) => ({
          deviceId: m.deviceId,
          dpCode: m.dpCode,
          metric: m.metric,
          unit: m.unit,
          scale: m.scale,
        })),
      );
    }

    this.logger.log(
      `Registered ${req.deviceId} with ${mapped.length} mapped metric(s)` +
        (unmapped.length ? `, ${unmapped.length} unmapped DP code(s): ${unmapped.join(", ")}` : ""),
    );

    return {
      device: {
        id: req.deviceId,
        label: req.label,
        placement: req.placement,
        groupName: req.groupName,
        roomVolumeM3: req.roomVolumeM3,
      },
      mappedMetrics: mapped,
      unmappedDpCodes: unmapped,
    };
  }

  /**
   * Renames / re-places / re-groups an already-registered device. Only the
   * fields present in `req` are written, so a rename can't clobber placement.
   * Does not touch `device_metrics` or any stored reading — the DP mapping and
   * the raw history belong to the hardware, not to what we call it.
   */
  async update(deviceId: string, req: UpdateDeviceRequest): Promise<DeviceDto> {
    const set: Partial<typeof devices.$inferInsert> = {};
    if (req.label !== undefined) set.label = req.label;
    if (req.placement !== undefined) set.placement = req.placement;
    if (req.groupName !== undefined) set.groupName = req.groupName;
    if (req.roomVolumeM3 !== undefined) set.roomVolumeM3 = req.roomVolumeM3;

    if (Object.keys(set).length === 0) {
      const current = await this.get(deviceId);
      return current;
    }

    const updated = await this.db
      .update(devices)
      .set(set)
      .where(eq(devices.id, deviceId))
      .returning()
      .get();

    if (!updated) {
      throw new NotFoundException(`Device ${deviceId} is not registered`);
    }

    this.logger.log(
      `Updated ${deviceId}: ${Object.keys(set).join(", ")}`,
    );

    return {
      id: updated.id,
      label: updated.label,
      placement: updated.placement,
      groupName: updated.groupName,
      roomVolumeM3: updated.roomVolumeM3,
    };
  }

  private async get(deviceId: string): Promise<DeviceDto> {
    const row = await this.db
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId))
      .get();
    if (!row) {
      throw new NotFoundException(`Device ${deviceId} is not registered`);
    }
    return {
      id: row.id,
      label: row.label,
      placement: row.placement,
      groupName: row.groupName,
      roomVolumeM3: row.roomVolumeM3,
    };
  }

  /** Locally registered devices — what the poller and dashboard actually read. */
  async list(): Promise<DeviceDto[]> {
    const rows = await this.db.select().from(devices);
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      placement: r.placement,
      groupName: r.groupName,
      roomVolumeM3: r.roomVolumeM3,
    }));
  }

  async getMetrics(deviceId: string): Promise<DeviceMetricDto[]> {
    const device = await this.db
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId))
      .get();
    if (!device) {
      throw new NotFoundException(`Device ${deviceId} is not registered`);
    }

    const rows = await this.db
      .select()
      .from(deviceMetrics)
      .where(eq(deviceMetrics.deviceId, deviceId));
    return rows.map((r) => ({
      deviceId: r.deviceId,
      dpCode: r.dpCode,
      metric: r.metric as DeviceMetricDto["metric"],
      unit: r.unit,
      scale: r.scale,
    }));
  }
}
