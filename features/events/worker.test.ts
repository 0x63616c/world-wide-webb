import { describe, expect, it, vi } from "vitest";
import { alarmService } from "./service";
import { cycles, runAlarmCycle, runAlarmLightCycle } from "./worker";

describe("alarm interval worker", () => {
  it("runs on startup and every second", () => {
    expect(cycles[0]).toMatchObject({ name: "alarm-clock", intervalMs: 1000, runOnStart: true });
    expect(cycles[1]).toMatchObject({ name: "alarm-lights", intervalMs: 1000, runOnStart: true });
  });
  it("schedules independently while a light delivery is stalled", async () => {
    let finishDelivery: () => void = () => {};
    const service = {
      ...alarmService,
      claimDue: vi.fn().mockResolvedValue(1),
      deliverLights: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishDelivery = resolve;
          }),
      ),
    };
    const now = new Date();
    const delivery = runAlarmLightCycle(service, vi.fn(), now);
    await runAlarmCycle(service, now);
    await runAlarmCycle(service, now);
    expect(service.claimDue).toHaveBeenCalledTimes(2);
    expect(service.claimDue).toHaveBeenCalledWith(now);
    expect(service.deliverLights).toHaveBeenCalledOnce();
    finishDelivery();
    await delivery;
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
