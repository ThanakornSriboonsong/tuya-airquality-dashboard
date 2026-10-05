import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { TuyaClientService } from "./tuya-client.service";

/**
 * Tuya answers HTTP 200 with `success: false` when it declines a call, so a
 * refusal is not a transport error and will not surface on its own. The poller
 * runs unattended for weeks; if a refusal reaches it as an ordinary response,
 * the real cause never reaches the log.
 */
function serviceReturning(response: unknown) {
  const config = {
    get: (key: string) =>
      ({
        TUYA_ACCESS_ID: "id",
        TUYA_ACCESS_SECRET: "secret",
        TUYA_BASE_URL: "https://example.invalid",
      })[key],
  } as unknown as ConfigService;

  const service = new TuyaClientService(config);
  service.onModuleInit();

  const request = vi.fn().mockResolvedValue(response);
  // The SDK context is created in onModuleInit; swap its transport only.
  (service as unknown as { context: { request: typeof request } }).context = {
    request,
  };

  return { service, request };
}

describe("TuyaClientService.request", () => {
  it("throws with Tuya's own reason when the call is refused", async () => {
    const { service } = serviceReturning({
      success: false,
      code: 28841002,
      msg: "IoT Core service subscription has expired.",
    });

    await expect(
      service.request({ method: "GET", path: "/v1.0/things" }),
    ).rejects.toThrow("IoT Core service subscription has expired.");
  });

  it("names the endpoint and code so the log identifies the failing call", async () => {
    const { service } = serviceReturning({
      success: false,
      code: 1010,
      msg: "token invalid",
    });

    await expect(
      service.request({ method: "GET", path: "/v1.0/devices/abc/logs" }),
    ).rejects.toThrow(/GET \/v1\.0\/devices\/abc\/logs \(1010\)/);
  });

  it("passes a successful response straight through", async () => {
    const { service } = serviceReturning({
      success: true,
      result: { list: [1, 2, 3] },
    });

    const res = await service.request<{ list: number[] }>({
      method: "GET",
      path: "/v1.0/things",
    });

    expect(res.result).toEqual({ list: [1, 2, 3] });
  });

  it("does not throw when success is absent, since not every endpoint sets it", async () => {
    const { service } = serviceReturning({ result: { ok: true } });

    await expect(
      service.request({ method: "GET", path: "/v1.0/things" }),
    ).resolves.toBeDefined();
  });
});
