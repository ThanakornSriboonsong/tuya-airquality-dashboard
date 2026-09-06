import { Module } from "@nestjs/common";
import { TuyaModule } from "../tuya/tuya.module";
import { PollerService } from "./poller.service";

@Module({
  imports: [TuyaModule],
  providers: [PollerService],
})
export class PollerModule {}
