import { Module } from "@nestjs/common";
import { TuyaClientService } from "./tuya-client.service";

@Module({
  providers: [TuyaClientService],
  exports: [TuyaClientService],
})
export class TuyaModule {}
