import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { sql } from "drizzle-orm";
import { TuyaClientService } from "../tuya/tuya-client.service";
import { DB } from "../db/db.module";
import type { Db } from "../db/client";
import { devices, deviceMetrics, readings } from "../db/schema";

const MAX_BACKOFF_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_INTERVAL_MS = 60_000;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_DEVICE_PER_TICK = 20; // caps worst case at 2000 events/device/tick
// Tuya's report-logs is queried up to (now - this buffer) so a report that's
// still being ingested server-side at the instant we poll isn't missed by a
// window boundary that's already moved past it.
const REPORT_LAG_BUFFER_MS = 5_000;

/**
 * Polls each registered device's DP report history and writes raw readings.
 *
 * This reads `/v1.0/iot-03/devices/{id}/report-logs`, NOT the device-status
 * snapshot: that endpoint has no per-value timestamp, and the device-list
 * `update_time` field looked like a per-report timestamp but isn't — live
 * testing showed it staying frozen for hours while the device was actually
 * reporting new values every 1-3 seconds. report-logs gives the real
 * device-reported `event_time` per DP change and backfills any gap since the
 * last poll, so the poll interval no longer limits data resolution — only
 * how fresh the dashboard is and how many Tuya API calls we make.
 *
 * Safety rules (see CLAUDE.md) this must never violate:
 *   - never write a value it didn't just receive from Tuya (no fabrication)
 *   - never insert a duplicate for an event already recorded (cursor is the
 *     max event_time seen per device, advanced only after a successful write)
 *   - on any error, leave a gap and back off — never guess
 */
@Injectable()
export class PollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PollerService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalMs: number;
  private consecutiveFailures = 0;
  private readonly cursorByDevice = new Map<string, number>();

  // tsx (esbuild) doesn't emit TS decorator metadata, so inject explicitly.
  constructor(
    @Inject(TuyaClientService) private readonly tuya: TuyaClientService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DB) private readonly db: Db,
  ) {
    this.intervalMs = Number(
      this.config.get("POLL_INTERVAL_MS") ?? DEFAULT_INTERVAL_MS,
    );
  }

  async onModuleInit() {
    await this.loadCursors();
    this.scheduleNext(0);
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  private async loadCursors() {
    const rows = await this.db
      .select({
        deviceId: readings.deviceId,
        maxTs: sql<number>`max(${readings.ts})`,
      })
      .from(readings)
      .groupBy(readings.deviceId);
    for (const row of rows) {
      this.cursorByDevice.set(row.deviceId, row.maxTs);
    }
  }

  private scheduleNext(delayMs: number) {
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick() {
    try {
      const written = await this.pollOnce();
      this.consecutiveFailures = 0;
      if (written > 0) this.logger.log(`Wrote ${written} reading(s).`);
      this.scheduleNext(this.intervalMs);
    } catch (err) {
      this.consecutiveFailures++;
      const backoff = Math.min(
        this.intervalMs * 2 ** this.consecutiveFailures,
        MAX_BACKOFF_MS,
      );
      this.logger.error(
        `Poll failed (attempt ${this.consecutiveFailures}): ${
          (err as Error).message
        }. Leaving a gap and retrying in ${Math.round(backoff / 1000)}s.`,
      );
      this.scheduleNext(backoff);
    }
  }

  private async pollOnce(): Promise<number> {
    const registeredDevices = await this.db.select().from(devices);
    if (registeredDevices.length === 0) return 0;

    const metricRows = await this.db.select().from(deviceMetrics);
    const metricsByDevice = new Map<string, typeof metricRows>();
    for (const row of metricRows) {
      const list = metricsByDevice.get(row.deviceId) ?? [];
      list.push(row);
      metricsByDevice.set(row.deviceId, list);
    }

    const endTime = Date.now() - REPORT_LAG_BUFFER_MS;
    let totalWritten = 0;

    for (const device of registeredDevices) {
      const deviceMetricRows = metricsByDevice.get(device.id) ?? [];
      if (deviceMetricRows.length === 0) continue; // nothing mapped to track yet

      const dpToMetric = new Map(deviceMetricRows.map((m) => [m.dpCode, m.metric]));
      const codes = [...dpToMetric.keys()];
      // Default lookback of one interval on first-ever poll for this device;
      // avoids trying to backfill a device's entire lifetime on registration.
      const startTime = (this.cursorByDevice.get(device.id) ?? endTime - this.intervalMs) + 1;
      if (startTime > endTime) continue;

      totalWritten += await this.pollDevice(device.id, codes, dpToMetric, startTime, endTime);
    }

    return totalWritten;
  }

  private async pollDevice(
    deviceId: string,
    codes: string[],
    dpToMetric: Map<string, string>,
    startTime: number,
    endTime: number,
  ): Promise<number> {
    let lastRowKey: string | undefined;
    let maxEventTime = this.cursorByDevice.get(deviceId) ?? startTime - 1;
    let written = 0;

    for (let page = 0; page < MAX_PAGES_PER_DEVICE_PER_TICK; page++) {
      const result = await this.tuya.getReportLogs({
        deviceId,
        codes,
        startTime,
        endTime,
        lastRowKey,
        size: PAGE_SIZE,
      });

      if (result.list.length > 0) {
        const rowsToInsert = [];
        for (const entry of result.list) {
          const metric = dpToMetric.get(entry.code);
          if (!metric) continue; // shouldn't happen given the codes filter, but be defensive

          const value = Number(entry.value);
          if (!Number.isFinite(value)) continue; // non-numeric DP, skip

          rowsToInsert.push({ ts: entry.event_time, deviceId, metric, value });
          if (entry.event_time > maxEventTime) maxEventTime = entry.event_time;
        }

        if (rowsToInsert.length > 0) {
          await this.db.insert(readings).values(rowsToInsert).onConflictDoNothing();
          written += rowsToInsert.length;
        }
      }

      // Advance the cursor after each page so a mid-backfill cap next tick
      // resumes from here instead of re-fetching what we already wrote.
      this.cursorByDevice.set(deviceId, maxEventTime);

      if (!result.has_more) break;
      lastRowKey = result.last_row_key;

      if (page === MAX_PAGES_PER_DEVICE_PER_TICK - 1) {
        this.logger.warn(
          `${deviceId} still has more report-log pages after ${MAX_PAGES_PER_DEVICE_PER_TICK}; ` +
            `continuing next poll.`,
        );
      }
    }

    return written;
  }
}
