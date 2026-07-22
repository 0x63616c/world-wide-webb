import { describe, expect, it } from "vitest";
import { formatBattery } from "../useBatteryInfo";

describe("formatBattery", () => {
  it("renders the rounded percent only", () => {
    expect(formatBattery({ level: 0.87, isCharging: false })).toBe("87%");
  });

  it("ignores charging state , the string is percent-only (colour conveys charging)", () => {
    expect(formatBattery({ level: 0.87, isCharging: true })).toBe("87%");
  });
});
