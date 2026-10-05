import { describe, expect, it, vi } from "vitest";
import { alarmService } from "./service";
import { cycles, runAlarmCycle } from "./worker";

describe("alarm interval worker", () => {
  it("runs on startup and every second", () => {
    expect(cycles[0]).toMatchObject({ name: "alarm-clock", intervalMs: 1000, runOnStart: true });
  });
  it("commits claims before attempting light delivery", async () => {
    const order: string[] = [];
    const service = {
      ...alarmService,
      claimDue: vi.fn(async () => {
        order.push("claim");
        return 1;
      }),
      deliverLights: vi.fn(async () => {
        order.push("deliver");
      }),
    };
    const now = new Date();
    await runAlarmCycle(service, vi.fn(), now);
    expect(order).toEqual(["claim", "deliver"]);
    expect(service.claimDue).toHaveBeenCalledWith(now);
  });
  it("leaves a failed claim retryable and does not fire external effects", async () => {
    const service = {
      ...alarmService,
      claimDue: vi.fn().mockRejectedValue(new Error("PG unavailable")),
      deliverLights: vi.fn(),
    };
    await expect(runAlarmCycle(service)).rejects.toThrow("PG unavailable");
    expect(service.deliverLights).not.toHaveBeenCalled();
  });
});
