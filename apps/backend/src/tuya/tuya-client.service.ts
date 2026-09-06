import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TuyaContext, TuyaResponse } from "@tuya/tuya-connector-nodejs";

/**
 * Thin wrapper around the Tuya SDK context. The SDK handles HMAC request
 * signing and access-token refresh internally; this service only owns
 * configuration and exposes typed helpers plus a generic escape hatch.
 */
@Injectable()
export class TuyaClientService implements OnModuleInit {
  private readonly logger = new Logger(TuyaClientService.name);
  private context!: TuyaContext;

  // tsx (esbuild) doesn't emit TS decorator metadata, so Nest can't infer
  // constructor param types at runtime — inject explicitly by token.
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  onModuleInit() {
    const accessKey = this.config.get<string>("TUYA_ACCESS_ID");
    const secretKey = this.config.get<string>("TUYA_ACCESS_SECRET");
    const baseUrl = this.config.get<string>("TUYA_BASE_URL");

    if (!accessKey || !secretKey || !baseUrl) {
      // Fail loudly per project rules: an air-quality test rig with no Tuya
      // access is useless, and silently limping along would just hide it.
      throw new Error(
        "Missing Tuya credentials. Set TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, " +
          "and TUYA_BASE_URL in .env (see .env.example).",
      );
    }

    this.context = new TuyaContext({ baseUrl, accessKey, secretKey });
    this.logger.log(`Tuya client configured for ${baseUrl}`);
  }

  /** Generic escape hatch for endpoints not covered by a dedicated method. */
  request<T = unknown>(options: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    query?: Record<string, string | number | boolean>;
    body?: Record<string, unknown>;
  }): Promise<TuyaResponse<T>> {
    return this.context.request<T>(options);
  }

  /** Lists devices linked to the given Smart Life / Tuya Smart app account. */
  async listDevicesForUser(uid: string) {
    return this.request<
      Array<{ id: string; name: string; category: string }>
    >({
      method: "GET",
      path: `/v1.0/users/${uid}/devices`,
    });
  }

  /** DP codes, types, and allowed values for one device — never hardcode these. */
  async getDeviceSpecifications(deviceId: string) {
    return this.request<{
      category: string;
      functions: Array<{ code: string; type: string; values: string }>;
      status: Array<{ code: string; type: string; values: string }>;
    }>({
      method: "GET",
      path: `/v1.0/devices/${deviceId}/specifications`,
    });
  }

  /**
   * Per-DP-change report history for one device, with real device-reported
   * timestamps (`event_time`, ms). This is the actual source for hard rule 3
   * — the device-level `update_time` from `/v1.0/iot-03/devices` looked like
   * a per-report timestamp but isn't: it stayed frozen for hours while live
   * testing showed `report-logs` capturing a new event every 1-3 seconds.
   * `codes` should be the DP codes this device has mapped in `device_metrics`,
   * so unmapped/noisy codes (alarms, battery, ...) never come back at all.
   */
  async getReportLogs(options: {
    deviceId: string;
    codes: string[];
    startTime: number;
    endTime: number;
    lastRowKey?: string;
    size?: number;
  }) {
    const res = await this.request<{
      has_more: boolean;
      last_row_key: string;
      list: Array<{ code: string; value: string; event_time: number }>;
    }>({
      method: "GET",
      path: `/v1.0/iot-03/devices/${options.deviceId}/report-logs`,
      query: {
        codes: options.codes.join(","),
        start_time: options.startTime,
        end_time: options.endTime,
        size: options.size ?? 100,
        ...(options.lastRowKey ? { last_row_key: options.lastRowKey } : {}),
      },
    });
    return res.result;
  }
}
