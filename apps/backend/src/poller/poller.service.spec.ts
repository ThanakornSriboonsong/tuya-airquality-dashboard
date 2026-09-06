import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { Metric } from "@tuya-dashboard/shared";
import { PollerService } from "./poller.service";
import { createTestDb } from "./test-db";
import { devices, deviceMetrics, readings } from "../db/schema";
import type { TuyaClientService } from "../tuya/tuya-client.service";

function makeFakeTuya() {
  return {
    getReportLogs: vi.fn(),
  } as unknown as TuyaClientService & { getReportLogs: ReturnType<typeof vi.fn> };
}

function makeFakeConfig(): ConfigService {
  return { get: () => undefined } as unknown as ConfigService;
}

function page(list: Array<{ code: string; value: string; event_time: number }>, hasMore = false, lastRowKey = "") {
  return { list, has_more: hasMore, last_row_key: lastRowKey };
}

describe("PollerService.pollOnce", () => {
  let db: ReturnType<typeof createTestDb>;
  let tuya: ReturnType<typeof makeFakeTuya>;
  let service: PollerService;

  beforeEach(async () => {
    db = createTestDb();
    tuya = makeFakeTuya();
    service = new PollerService(tuya, makeFakeConfig(), db);

    await db.insert(devices).values({
      id: "dev1",
      label: "Test Device",
      placement: "indoor",
      roomVolumeM3: null,
    });
    await db.insert(deviceMetrics).values([
      { deviceId: "dev1", dpCode: "pm25_value", metric: Metric.PM25, unit: "ug/m3", scale: 0 },
      { deviceId: "dev1", dpCode: "voc_value", metric: Metric.VOC, unit: "mg/m3", scale: 3 },
    ]);
  });

  const pollOnce = () => (service as unknown as { pollOnce(): Promise<number> }).pollOnce();

  it("does nothing when there are no registered devices", async () => {
    const emptyDb = createTestDb();
    const emptyService = new PollerService(tuya, makeFakeConfig(), emptyDb);
    const written = await (emptyService as unknown as { pollOnce(): Promise<number> }).pollOnce();
    expect(written).toBe(0);
    expect(tuya.getReportLogs).not.toHaveBeenCalled();
  });

  it("skips a registered device with no mapped metrics yet, without calling Tuya", async () => {
    await db.insert(devices).values({ id: "dev2", label: "Unmapped", placement: "outdoor", roomVolumeM3: null });
    tuya.getReportLogs.mockResolvedValue(page([]));

    await pollOnce();

    const calledDeviceIds = tuya.getReportLogs.mock.calls.map((c) => c[0].deviceId);
    expect(calledDeviceIds).not.toContain("dev2");
  });

  it("stores raw values (no scale applied) from a single page", async () => {
    tuya.getReportLogs.mockResolvedValue(
      page([
        { code: "pm25_value", value: "42", event_time: 1_700_000_000_000 },
        { code: "voc_value", value: "500", event_time: 1_700_000_000_500 },
      ]),
    );

    const written = await pollOnce();
    expect(written).toBe(2);

    const rows = await db.select().from(readings);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.metric === Metric.PM25)?.value).toBe(42);
    expect(rows.find((r) => r.metric === Metric.VOC)?.value).toBe(500);
  });

  it("follows pagination via last_row_key and inserts entries from every page", async () => {
    const now = Date.now();
    tuya.getReportLogs
      .mockResolvedValueOnce(
        page([{ code: "pm25_value", value: "10", event_time: now - 20_000 }], true, "cursor-1"),
      )
      .mockResolvedValueOnce(
        page([{ code: "pm25_value", value: "11", event_time: now - 10_000 }], false),
      );

    const written = await pollOnce();
    expect(written).toBe(2);
    expect(tuya.getReportLogs).toHaveBeenCalledTimes(2);
    expect(tuya.getReportLogs.mock.calls[1][0].lastRowKey).toBe("cursor-1");

    const rows = await db.select().from(readings);
    expect(rows.map((r) => r.value).sort()).toEqual([10, 11]);
  });

  it("advances the cursor so the next poll only asks for events after the last one seen", async () => {
    // Tuya only ever returns events within the queried [startTime, endTime]
    // window, so event_time must be realistic (recent) here, not a small
    // fixture number — otherwise it'd never exceed the first-poll lookback
    // baseline and this test would be exercising an impossible API response.
    const eventTime = Date.now() - 10_000;
    tuya.getReportLogs.mockResolvedValueOnce(
      page([{ code: "pm25_value", value: "10", event_time: eventTime }], false),
    );
    await pollOnce();

    tuya.getReportLogs.mockResolvedValueOnce(page([]));
    await pollOnce();

    expect(tuya.getReportLogs.mock.calls[1][0].startTime).toBe(eventTime + 1);
  });

  it("keeps rows already written when a later page fails, and still surfaces the error", async () => {
    tuya.getReportLogs
      .mockResolvedValueOnce(
        page([{ code: "pm25_value", value: "10", event_time: Date.now() - 10_000 }], true, "cursor-1"),
      )
      .mockRejectedValueOnce(new Error("network error"));

    await expect(pollOnce()).rejects.toThrow("network error");

    const rows = await db.select().from(readings);
    expect(rows).toHaveLength(1); // first page's real reading wasn't lost
    expect(rows[0].value).toBe(10);
  });

  it("stops after the page cap instead of looping forever on an endless has_more", async () => {
    tuya.getReportLogs.mockResolvedValue(
      page([{ code: "pm25_value", value: "1", event_time: Date.now() - 10_000 }], true, "same"),
    );

    await pollOnce();

    expect(tuya.getReportLogs.mock.calls.length).toBeLessThanOrEqual(20);
    expect(tuya.getReportLogs.mock.calls.length).toBeGreaterThan(1);
  });

  it("never writes anything when the Tuya API call fails on the first page", async () => {
    tuya.getReportLogs.mockRejectedValue(new Error("network error"));

    await expect(pollOnce()).rejects.toThrow("network error");

    const rows = await db.select().from(readings);
    expect(rows).toHaveLength(0);
  });
});
