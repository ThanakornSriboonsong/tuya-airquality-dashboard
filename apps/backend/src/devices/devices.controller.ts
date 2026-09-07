import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type {
  Placement,
  RegisterDeviceRequest,
  UpdateDeviceRequest,
} from "@tuya-dashboard/shared";
import { DevicesService } from "./devices.service";

function parsePlacement(value: unknown): Placement {
  if (value !== "indoor" && value !== "outdoor") {
    throw new BadRequestException('placement must be "indoor" or "outdoor"');
  }
  return value;
}

/** Blank/whitespace group names collapse to null so "ungrouped" has one representation. */
function parseGroupName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("groupName must be a string or null");
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseRoomVolume(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new BadRequestException(
      "roomVolumeM3 must be a positive number or null",
    );
  }
  return value;
}

@Controller("devices")
export class DevicesController {
  constructor(
    @Inject(DevicesService) private readonly devices: DevicesService,
  ) {}

  @Get()
  list() {
    return this.devices.list();
  }

  @Get("discover")
  discover() {
    return this.devices.discover();
  }

  @Post()
  register(@Body() body: RegisterDeviceRequest) {
    if (!body?.deviceId || !body?.label || !body?.placement) {
      throw new BadRequestException(
        "deviceId, label, and placement are required",
      );
    }
    return this.devices.register({
      deviceId: body.deviceId,
      label: body.label.trim(),
      placement: parsePlacement(body.placement),
      groupName: parseGroupName(body.groupName),
      roomVolumeM3: parseRoomVolume(body.roomVolumeM3),
    });
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: UpdateDeviceRequest) {
    const patch: UpdateDeviceRequest = {};

    if (body?.label !== undefined) {
      const label = String(body.label).trim();
      if (!label) throw new BadRequestException("label cannot be empty");
      patch.label = label;
    }
    if (body?.placement !== undefined) {
      patch.placement = parsePlacement(body.placement);
    }
    if (body?.groupName !== undefined) {
      patch.groupName = parseGroupName(body.groupName);
    }
    if (body?.roomVolumeM3 !== undefined) {
      patch.roomVolumeM3 = parseRoomVolume(body.roomVolumeM3);
    }

    return this.devices.update(id, patch);
  }

  @Get(":id/specifications")
  getSpecification(@Param("id") id: string) {
    return this.devices.getSpecification(id);
  }

  @Get(":id/metrics")
  getMetrics(@Param("id") id: string) {
    return this.devices.getMetrics(id);
  }
}
