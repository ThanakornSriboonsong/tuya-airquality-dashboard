import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DbModule } from "./db/db.module";
import { DevicesModule } from "./devices/devices.module";
import { PollerModule } from "./poller/poller.module";
import { ReadingsModule } from "./readings/readings.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: "../../.env" }),
    DbModule,
    DevicesModule,
    ReadingsModule,
    PollerModule,
  ],
})
export class AppModule {}
