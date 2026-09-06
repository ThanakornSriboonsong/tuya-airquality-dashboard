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
        roomVolumeM3: req.roomVolumeM3,
      })
      .onConflictDoUpdate({
        target: devices.id,
        set: {
          label: req.label,
          placement: req.placement,
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
        roomVolumeM3: req.roomVolumeM3,
      },
      mappedMetrics: mapped,
      unmappedDpCodes: unmapped,
    };
  }

  /** Locally registered devices — what the poller and dashboard actually read. */
  async list(): Promise<DeviceDto[]> {
    const rows = await this.db.select().from(devices);
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      placement: r.placement,
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
