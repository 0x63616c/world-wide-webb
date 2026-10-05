import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./service", async (original) => {
  const actual = await original<typeof import("./service")>();
  return {
    ...actual,
    alarmService: {
      snapshot: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      setEnabled: vi.fn(),
      remove: vi.fn(),
      act: vi.fn(),
    },
  };
});

import { api } from "./api";
import { alarmInputSchema } from "./contract";
import { AlarmError, alarmService } from "./service";

// Procedures use feature-owned services, not the base router context's db.
const caller = api.createCaller({} as Parameters<typeof api.createCaller>[0]);
beforeEach(() => vi.clearAllMocks());
describe("alarms tRPC", () => {
  it("validates and forwards create/update/enable/delete to the domain", async () => {
    const input = alarmInputSchema.parse({ timeZone: "UTC", time: "09:00" });
    await caller.alarms.create(input);
    expect(alarmService.create).toHaveBeenCalledWith(input);
    await caller.alarms.update({ id: "alm_example", alarm: input });
    expect(alarmService.update).toHaveBeenCalledWith("alm_example", input);
    await caller.alarms.setEnabled({ id: "alm_example", enabled: false });
    expect(alarmService.setEnabled).toHaveBeenCalledWith("alm_example", false);
    await caller.alarms.delete({ id: "alm_example" });
    expect(alarmService.remove).toHaveBeenCalledWith("alm_example");
  });
  it("rejects bad input before calling the service", async () => {
    await expect(caller.alarms.create({ timeZone: "Mars", time: "99:00" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(alarmService.create).not.toHaveBeenCalled();
  });
  it("serves the snapshot and sends versioned snooze/stop actions", async () => {
    await caller.alarms.list();
    expect(alarmService.snapshot).toHaveBeenCalledOnce();
    await caller.alarms.snooze({ id: "alr_example", version: 2 });
    await caller.alarms.stop({ id: "alr_example", version: 4 });
    expect(alarmService.act).toHaveBeenNthCalledWith(1, "alr_example", 2, "snooze");
    expect(alarmService.act).toHaveBeenNthCalledWith(2, "alr_example", 4, "stop");
  });
  it.each([
    [400, "BAD_REQUEST"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
  ] as const)("maps domain error %s to %s", async (status, code) => {
    vi.mocked(alarmService.remove).mockRejectedValueOnce(new AlarmError(status, "Expected error"));
    await expect(caller.alarms.delete({ id: "alm_example" })).rejects.toMatchObject({
      code,
      message: "Expected error",
    });
  });
});
