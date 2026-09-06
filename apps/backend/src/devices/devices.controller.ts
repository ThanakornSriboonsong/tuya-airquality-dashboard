import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import type { RegisterDeviceRequest } from "@tuya-dashboard/shared";
import { DevicesService } from "./devices.service";

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
    if (body.placement !== "indoor" && body.placement !== "outdoor") {
      throw new BadRequestException('placement must be "indoor" or "outdoor"');
    }
    return this.devices.register({
      deviceId: body.deviceId,
      label: body.label,
      placement: body.placement,
      roomVolumeM3: body.roomVolumeM3 ?? null,
    });
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
