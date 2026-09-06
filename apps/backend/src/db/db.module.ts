import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createDb } from "./client";

export const DB = Symbol("DB");

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbPath = config.get<string>("DB_PATH");
        if (!dbPath) {
          throw new Error("DB_PATH is not set in .env");
        }
        return createDb(dbPath);
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}
