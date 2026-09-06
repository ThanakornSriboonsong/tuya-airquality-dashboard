import { Module } from "@nestjs/common";
import { TuyaModule } from "../tuya/tuya.module";
import { DevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";

@Module({
  imports: [TuyaModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
