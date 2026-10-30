import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./service", () => ({
  notificationService: { create: vi.fn(), list: vi.fn(), act: vi.fn(), dismissAll: vi.fn() },
}));

import { api } from "./api";
import { notificationService } from "./service";

const caller = api.createCaller({} as Parameters<typeof api.createCaller>[0]).notifications;
beforeEach(() => vi.clearAllMocks());
it("validates and forwards the additive tRPC surface", async () => {
  const input = { source_module: "walks", title: "Ready", body: "Go", deep_link: "module/walks" };
  await caller.create(input);
  expect(notificationService.create).toHaveBeenCalledWith({
    ...input,
    priority: "normal",
    dedupe_key: null,
  });
  await caller.list({ since: "0" });
  expect(notificationService.list).toHaveBeenCalledWith({ since: "0", limit: 100 });
  await caller.dismissAll();
  expect(notificationService.dismissAll).toHaveBeenCalledOnce();
  await expect(caller.create({ ...input, priority: "bad" as "normal" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
});
it("reports missing rows for both actions", async () => {
  vi.mocked(notificationService.act).mockResolvedValue(null);
  await expect(caller.read({ id: "ntf_abc" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(caller.dismiss({ id: "ntf_abc" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(notificationService.act).toHaveBeenCalledWith("ntf_abc", "read");
  expect(notificationService.act).toHaveBeenCalledWith("ntf_abc", "dismiss");
});
