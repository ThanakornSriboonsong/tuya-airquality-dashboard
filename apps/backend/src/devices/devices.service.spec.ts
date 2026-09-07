import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { DevicesService } from "./devices.service";
import { createTestDb } from "../poller/test-db";
import { devices } from "../db/schema";
import type { TuyaClientService } from "../tuya/tuya-client.service";

describe("DevicesService.update", () => {
  let db: ReturnType<typeof createTestDb>;
  let service: DevicesService;

  beforeEach(async () => {
    db = createTestDb();
    service = new DevicesService(
      {} as TuyaClientService,
      {} as ConfigService,
      db,
    );

    await db.insert(devices).values({
      id: "dev1",
      label: "Living room",
      placement: "indoor",
      groupName: "Rig A",
      roomVolumeM3: 32,
    });
  });

  it("renames a device without touching its other fields", async () => {
    const updated = await service.update("dev1", { label: "Bedroom" });

    expect(updated).toEqual({
      id: "dev1",
      label: "Bedroom",
      placement: "indoor",
      groupName: "Rig A",
      roomVolumeM3: 32,
    });
  });

  it("re-places a device without clearing its group or volume", async () => {
    const updated = await service.update("dev1", { placement: "outdoor" });

    expect(updated.placement).toBe("outdoor");
    expect(updated.groupName).toBe("Rig A");
    expect(updated.roomVolumeM3).toBe(32);
  });

  it("clears the group when groupName is explicitly null", async () => {
    const updated = await service.update("dev1", { groupName: null });

    expect(updated.groupName).toBeNull();
    expect(updated.label).toBe("Living room");
  });

  it("leaves the row untouched when the patch is empty", async () => {
    const updated = await service.update("dev1", {});

    expect(updated.label).toBe("Living room");
    expect(updated.groupName).toBe("Rig A");
  });

  it("rejects an unregistered device instead of inserting one", async () => {
    await expect(service.update("nope", { label: "x" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const rows = await db.select().from(devices);
    expect(rows).toHaveLength(1);
  });
});
