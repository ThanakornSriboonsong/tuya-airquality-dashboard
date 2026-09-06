import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  Metric,
  pm25ToAqi,
  type LatestReadingDto,
  type ReadingResultDto,
} from "@tuya-dashboard/shared";
import { DB } from "../db/db.module";
import type { Db } from "../db/client";
import { calibration, deviceMetrics, devices, readings } from "../db/schema";

interface QueryFilters {
  deviceId?: string;
  metric?: string;
  from?: number;
  to?: number;
}

interface CalRow {
  slope: number;
  intercept: number;
  validFrom: number;
}

@Injectable()
export class ReadingsService {
  // tsx (esbuild) doesn't emit TS decorator metadata, so inject explicitly.
  constructor(@Inject(DB) private readonly db: Db) {}

  private async loadScaleMap(deviceIds: string[]) {
    const rows = deviceIds.length
      ? await this.db
          .select()
          .from(deviceMetrics)
          .where(inArray(deviceMetrics.deviceId, deviceIds))
      : [];
    const map = new Map<string, number>();
    for (const r of rows) map.set(`${r.deviceId}:${r.metric}`, r.scale);
    return map;
  }

  private async loadCalibrationMap(deviceIds: string[]) {
    const rows = deviceIds.length
      ? await this.db
          .select()
          .from(calibration)
          .where(inArray(calibration.deviceId, deviceIds))
      : [];
    const map = new Map<string, CalRow[]>();
    for (const r of rows) {
      const key = `${r.deviceId}:${r.metric}`;
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.validFrom - b.validFrom);
    return map;
  }

  /** Most recent calibration fit that was valid at the time the reading was taken. */
  private applyCalibration(rawActual: number, ts: number, calList?: CalRow[]) {
    if (!calList?.length) return rawActual;
    let applicable: CalRow | undefined;
    for (const c of calList) {
      if (c.validFrom <= ts) applicable = c;
      else break;
    }
    return applicable ? rawActual * applicable.slope + applicable.intercept : rawActual;
  }

  /** Converts a raw stored value to its calibrated physical value + AQI (pm25 only). */
  private resolve(
    row: { ts: number; deviceId: string; metric: string; value: number },
    scaleMap: Map<string, number>,
    calMap: Map<string, CalRow[]>,
  ): ReadingResultDto {
    const key = `${row.deviceId}:${row.metric}`;
    const scale = scaleMap.get(key) ?? 0;
    const actual = row.value / 10 ** scale;
    const calibrated = this.applyCalibration(actual, row.ts, calMap.get(key));
    const aqi = row.metric === Metric.PM25 ? pm25ToAqi(calibrated) : null;
    return {
      ts: row.ts,
      deviceId: row.deviceId,
      metric: row.metric as Metric,
      value: calibrated,
      aqi,
    };
  }

  async query(filters: QueryFilters): Promise<ReadingResultDto[]> {
    const conditions = [];
    if (filters.deviceId) conditions.push(eq(readings.deviceId, filters.deviceId));
    if (filters.metric) conditions.push(eq(readings.metric, filters.metric));
    if (filters.from !== undefined) conditions.push(gte(readings.ts, filters.from));
    if (filters.to !== undefined) conditions.push(lte(readings.ts, filters.to));

    const rows = await this.db
      .select()
      .from(readings)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(readings.ts));

    const deviceIds = [...new Set(rows.map((r) => r.deviceId))];
    const scaleMap = await this.loadScaleMap(deviceIds);
    const calMap = await this.loadCalibrationMap(deviceIds);

    return rows.map((r) => this.resolve(r, scaleMap, calMap));
  }

  /** Latest reading per (device, metric) — powers the dashboard summary cards. */
  async latest(): Promise<LatestReadingDto[]> {
    const allDevices = await this.db.select().from(devices);
    if (allDevices.length === 0) return [];
    const deviceIds = allDevices.map((d) => d.id);

    const latestTs = this.db
      .select({
        deviceId: readings.deviceId,
        metric: readings.metric,
        maxTs: sql<number>`max(${readings.ts})`.as("max_ts"),
      })
      .from(readings)
      .where(inArray(readings.deviceId, deviceIds))
      .groupBy(readings.deviceId, readings.metric)
      .as("latest_ts");

    const rows = await this.db
      .select({
        ts: readings.ts,
        deviceId: readings.deviceId,
        metric: readings.metric,
        value: readings.value,
      })
      .from(readings)
      .innerJoin(
        latestTs,
        and(
          eq(readings.deviceId, latestTs.deviceId),
          eq(readings.metric, latestTs.metric),
          eq(readings.ts, latestTs.maxTs),
        ),
      );

    const scaleMap = await this.loadScaleMap(deviceIds);
    const calMap = await this.loadCalibrationMap(deviceIds);
    const deviceById = new Map(allDevices.map((d) => [d.id, d]));

    return rows.map((r) => {
      const resolved = this.resolve(r, scaleMap, calMap);
      const device = deviceById.get(r.deviceId)!;
      return { ...resolved, placement: device.placement, label: device.label };
    });
  }
}
