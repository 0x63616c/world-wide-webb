import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./service", () => ({
  notificationService: { create: vi.fn(), list: vi.fn(), act: vi.fn(), dismissAll: vi.fn() },
}));

import { routes } from "./http";
import { notificationService } from "./service";

const input = {
  source_module: "walks",
  title: "Walk",
  body: "Ready",
  deep_link: "module/walks",
  priority: "normal",
  dedupe_key: null,
};
const row = {
  ...input,
  id: "ntf_abc",
  created_at: "2026-10-30T12:00:00.000Z",
  updated_at: "2026-10-30T12:00:00.000Z",
  read_at: null,
  dismissed_at: null,
  revision: "1",
};
const page = { items: [row], cursor: "1", has_more: false };
function request(path = "", method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const req = new Request(`https://panel.test/api/notifications${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  const route = routes.find((r) => r.method === method && r.path === new URL(req.url).pathname);
  if (!route) throw new Error("Missing notification route");
  return route.handler(req, new URL(req.url));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(notificationService.create).mockResolvedValue(row);
  vi.mocked(notificationService.list).mockResolvedValue(page);
  vi.mocked(notificationService.act).mockResolvedValue(row);
});
it("creates and lists through the panel perimeter without a new token", async () => {
  const response = await request("", "POST", input);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual(row);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await (await request("?since=0&unread=true&limit=10")).json()).toEqual(page);
  expect(notificationService.list).toHaveBeenCalledWith({ since: "0", unread: "true", limit: 10 });
});
it("rejects malformed JSON, content type, oversized bodies and invalid filters", async () => {
  for (const value of ["{", "x".repeat(32769), {}, { ...input, priority: "urgent" }])
    expect((await request("", "POST", value)).status).toBe(400);
  expect((await request("", "POST", input, { "Content-Type": "text/plain" })).status).toBe(400);
  for (const query of ["?limit=0", "?unread=yes", "?since=-1"])
    expect((await request(query)).status).toBe(400);
  expect(notificationService.create).not.toHaveBeenCalled();
});
it("marks read, dismisses, dismisses all, and returns 404 for missing rows", async () => {
  for (const action of ["read", "dismiss"])
    expect(await (await request(`/${action}`, "POST", { id: row.id })).json()).toEqual(row);
  expect(notificationService.act).toHaveBeenCalledWith(row.id, "dismiss");
  vi.mocked(notificationService.act).mockResolvedValueOnce(null);
  expect((await request("/read", "POST", { id: row.id })).status).toBe(404);
  expect((await request("/read", "POST", { id: "bad" })).status).toBe(400);
  vi.mocked(notificationService.dismissAll).mockResolvedValueOnce({ dismissed: 2 });
  expect(await (await request("/dismiss-all", "POST")).json()).toEqual({ dismissed: 2 });
});
it("streams the GET envelope and resumes using Last-Event-ID before the query", async () => {
  const response = await request("/stream?since=0", "GET", undefined, { "Last-Event-ID": "7" });
  expect(response.headers.get("Content-Type")).toBe("text/event-stream");
  expect(response.headers.get("X-Accel-Buffering")).toBe("no");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing SSE body");
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(
    `id: 1\nevent: notifications\ndata: ${JSON.stringify(page)}\n\n`,
  );
  expect(notificationService.list).toHaveBeenCalledWith({ since: "7", limit: 200 });
  await reader.cancel();
  expect((await request("/stream?since=bad")).status).toBe(400);
});
it("surfaces storage errors instead of claiming success", async () => {
  vi.mocked(notificationService.create).mockRejectedValueOnce(new Error("DB unavailable"));
  await expect(request("", "POST", input)).rejects.toThrow("DB unavailable");
});
