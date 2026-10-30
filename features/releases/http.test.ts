import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  config: { ALARM_API_TOKEN: "test-release-token-at-least-32-characters" },
}));
vi.mock("./service", () => ({ releaseService: { latest: vi.fn(), record: vi.fn() } }));

import { config } from "./config";
import { routes } from "./http";
import { releaseService } from "./service";

const release = { app: "panel", build: 99, updatedAt: "2026-10-30T12:00:00.000Z" };
function request(
  method = "POST",
  body: unknown = { app: "panel", build: 99 },
  token = config.ALARM_API_TOKEN,
  query = "?app=panel",
  raw?: string,
) {
  const req = new Request(`https://panel.test/api/releases/latest${query}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: raw ?? JSON.stringify(body) } : {}),
  });
  const route = routes.find((r) => r.method === method);
  if (!route) throw new Error("Missing release route");
  return route.handler(req, new URL(req.url));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(releaseService.record).mockResolvedValue(release);
});
it("authenticates before parsing and uses the existing token", async () => {
  expect((await request("POST", {}, "bad", "", "{")).status).toBe(401);
  expect(releaseService.record).not.toHaveBeenCalled();
  const previous = config.ALARM_API_TOKEN;
  Object.assign(config, { ALARM_API_TOKEN: "" });
  try {
    expect((await request()).status).toBe(503);
  } finally {
    Object.assign(config, { ALARM_API_TOKEN: previous });
  }
});
it("records validated builds and returns the current monotonic result", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(release);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(releaseService.record).toHaveBeenCalledWith({ app: "panel", build: 99 });
});
it.each([
  { app: "", build: 1 },
  { app: "../panel", build: 1 },
  { app: "panel", build: 0 },
  { app: "panel", build: -1 },
  { app: "panel", build: 1.5 },
  { app: "panel", build: "99" },
  { app: "panel", build: 2147483648 },
])("rejects invalid release %j", async (body) => {
  expect((await request("POST", body)).status).toBe(400);
  expect(releaseService.record).not.toHaveBeenCalled();
});
it("rejects malformed and oversized bodies", async () => {
  expect((await request("POST", {}, undefined, "", "{")).status).toBe(400);
  expect((await request("POST", {}, undefined, "", " ".repeat(1025))).status).toBe(400);
});
it("allows panel reads without automation bearer and reports missing releases", async () => {
  vi.mocked(releaseService.latest).mockResolvedValueOnce(release).mockResolvedValueOnce(null);
  expect(await (await request("GET", {}, "")).json()).toEqual(release);
  expect((await request("GET")).status).toBe(404);
  expect((await request("GET", {}, "", "")).status).toBe(400);
});
it("does not turn storage failures into success", async () => {
  vi.mocked(releaseService.record).mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(request()).rejects.toThrow("storage unavailable");
});
