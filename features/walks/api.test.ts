import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./service", () => ({
  walkService: {
    state: vi.fn(),
    history: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from "./api";
import { walkService } from "./service";

const caller = api.createCaller({} as Parameters<typeof api.createCaller>[0]);
beforeEach(() => vi.clearAllMocks());
describe("walks tRPC contract", () => {
  it("forwards every procedure, applying defaults", async () => {
    await caller.walks.state();
    await caller.walks.history();
    await caller.walks.start({});
    await caller.walks.stop({ id: "walk_example" });
    await caller.walks.update({ id: "walk_example", endedAt: "2026-01-01T12:00:00+01:00" });
    await caller.walks.delete({ id: "walk_example" });
    expect(walkService.state).toHaveBeenCalledOnce();
    expect(walkService.history).toHaveBeenCalledWith({ limit: 50 });
    expect(walkService.start).toHaveBeenCalledWith({ source: "unknown" });
    expect(walkService.stop).toHaveBeenCalledWith({ id: "walk_example" });
    expect(walkService.update).toHaveBeenCalledWith({
      id: "walk_example",
      endedAt: "2026-01-01T12:00:00+01:00",
    });
    expect(walkService.delete).toHaveBeenCalledWith("walk_example");
  });
  it("rejects malformed UUIDs, timestamps, sources, limits and ids", async () => {
    for (const input of [
      { id: "bad" },
      { startedAt: "today" },
      { startedAt: "2026-01-01T12:00:00" },
      { source: "watch" },
    ]) {
      await expect(caller.walks.start(input as never)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    for (const limit of [0, 501, 1.5])
      await expect(caller.walks.history({ limit })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.walks.stop({ id: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.walks.update({ id: "x", endedAt: "invalid" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(walkService.start).not.toHaveBeenCalled();
  });
});
