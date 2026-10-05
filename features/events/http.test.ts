import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  config: { ALARM_API_TOKEN: "test-only-alarm-token-with-32-characters" },
  alarmDefaults: () => ({ snoozeMinutes: 9, lightTarget: "light.bed_lamp_left" }),
}));
vi.mock("@app-kit/server", () => ({
  getSettings: vi.fn().mockResolvedValue({ timeZone: "America/Los_Angeles" }),
}));
vi.mock("./service", async (original) => {
  const actual = await original<typeof import("./service")>();
  return { ...actual, alarmService: { create: vi.fn(), snapshot: vi.fn(), act: vi.fn() } };
});

import { config } from "./config";
import { routes } from "./http";
import { AlarmError, alarmService } from "./service";

const token = "test-only-alarm-token-with-32-characters";
async function request(
  body: unknown = { time: "09:00" },
  opts: { token?: string; method?: string; path?: string; raw?: string; key?: string } = {},
) {
  const method = opts.method ?? "POST";
  const url = new URL(opts.path ?? "/api/alarms", "https://panel.test");
  const req = new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.token ?? token}`,
      ...(opts.key ? { "Idempotency-Key": opts.key } : {}),
    },
    ...(method === "POST" ? { body: opts.raw ?? JSON.stringify(body) } : {}),
  });
  const route = routes.find((r) => r.method === method && r.path === url.pathname);
  if (!route) throw new Error("Missing HTTP route");
  return route.handler(req, url);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(alarmService.create).mockResolvedValue({
    id: "alm_example",
    nextFireAt: "2026-10-06T16:00:00.000Z",
  });
});
describe("alarm HTTP automation", () => {
  it("authenticates before parsing or persisting, and rejects unset credentials", async () => {
    expect((await request({}, { token: "wrong", raw: "bad json" })).status).toBe(401);
    expect(alarmService.create).not.toHaveBeenCalled();
    const previous = config.ALARM_API_TOKEN;
    Object.assign(config, { ALARM_API_TOKEN: "" });
    expect((await request()).status).toBe(503);
    Object.assign(config, { ALARM_API_TOKEN: previous });
  });
  it("creates a Shortcut alarm using the installation timezone and idempotency key", async () => {
    const response = await request(
      { time: "09:00", label: "Wake up" },
      { key: "shortcut-request-123" },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(alarmService.create).toHaveBeenCalledWith(
      expect.objectContaining({ time: "09:00", timeZone: "America/Los_Angeles", label: "Wake up" }),
      "shortcut-request-123",
    );
  });
  it("accepts absolute iOS Shortcut dates with an explicit offset", async () => {
    expect(
      (await request({ at: "2026-10-06T09:00:00-07:00", timeZone: "America/Los_Angeles" })).status,
    ).toBe(201);
  });
  it.each([
    { time: "9 AM" },
    { repeatDays: [99] },
    { timeZone: "Mars" },
    { snoozeMinutes: 90 },
    { lightTarget: "script.foo" },
  ])("rejects invalid input %j", async (body) => {
    expect((await request(body)).status).toBe(400);
    expect(alarmService.create).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON, oversized bodies, and invalid retry keys", async () => {
    expect((await request({}, { raw: "{" })).status).toBe(400);
    expect((await request({}, { raw: "a".repeat(8193) })).status).toBe(400);
    expect((await request({}, { key: "bad key" })).status).toBe(400);
  });
  it("preserves conflict status and never pretends a database error succeeded", async () => {
    vi.mocked(alarmService.create).mockRejectedValueOnce(new AlarmError(409, "Key reused"));
    expect((await request()).status).toBe(409);
    vi.mocked(alarmService.create).mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(request()).rejects.toThrow("Database unavailable");
  });
  it("authenticates reads and versioned native actions", async () => {
    vi.mocked(alarmService.snapshot).mockResolvedValue({
      next: null,
      alarms: [],
      active: [],
      defaults: { snoozeMinutes: 9, lightTarget: "light.bed_lamp_left" },
      serverNow: "2026-10-05T16:00:00Z",
    });
    expect((await request({}, { method: "GET" })).status).toBe(200);
    vi.mocked(alarmService.act).mockResolvedValue({ id: "alr_example" });
    expect(
      (
        await request(
          { id: "alr_example", version: 2, action: "stop" },
          { path: "/api/alarms/action" },
        )
      ).status,
    ).toBe(200);
    expect(alarmService.act).toHaveBeenCalledWith("alr_example", 2, "stop");
  });
});
