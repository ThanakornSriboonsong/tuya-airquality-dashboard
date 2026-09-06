import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ReadingsService } from "./readings.service";

@Controller("readings")
export class ReadingsController {
  constructor(
    @Inject(ReadingsService) private readonly readings: ReadingsService,
  ) {}

  @Get("latest")
  latest() {
    return this.readings.latest();
  }

  @Get()
  query(
    @Query("deviceId") deviceId?: string,
    @Query("metric") metric?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.readings.query({
      deviceId,
      metric,
      from: from !== undefined ? Number(from) : undefined,
      to: to !== undefined ? Number(to) : undefined,
    });
  }
}
