import { describe, expect, it } from "vitest";

import { decideScheduleFires, type ScheduleRow } from "../services/schedule-service";

const sun = { sunriseIso: "2026-07-17T05:50", sunsetIso: "2026-07-17T20:40" };
// 2026-07-17 is a Friday (weekday 5).
const at = (h: number, m: number) => new Date(2026, 6, 17, h, m, 0);

const base: ScheduleRow = {
  id: "sched_a",
  enabled: true,
  days: [0, 1, 2, 3, 4, 5, 6],
  trigger: { type: "fixed", time: "21:30" },
  lastFiredDate: null,
};

describe("decideScheduleFires", () => {
  it("fires once the clock passes the trigger", () => {
    expect(decideScheduleFires(at(21, 30), [base], sun)).toEqual(["sched_a"]);
  });
  it("does not fire before the trigger time", () => {
    expect(decideScheduleFires(at(21, 29), [base], sun)).toEqual([]);
  });
  it("does not re-fire once lastFiredDate is today", () => {
    const fired = { ...base, lastFiredDate: "2026-07-17" };
    expect(decideScheduleFires(at(22, 0), [fired], sun)).toEqual([]);
  });
  it("skips a disabled schedule", () => {
    expect(decideScheduleFires(at(22, 0), [{ ...base, enabled: false }], sun)).toEqual([]);
  });
  it("skips when today's weekday is not selected (Fri=5)", () => {
    expect(decideScheduleFires(at(22, 0), [{ ...base, days: [0, 6] }], sun)).toEqual([]);
  });
  it("skips a sun trigger with no sun data (no invented time)", () => {
    const s: ScheduleRow = { ...base, trigger: { type: "sun", event: "sunrise", offsetMin: -30 } };
    expect(decideScheduleFires(at(23, 0), [s], { sunriseIso: null, sunsetIso: null })).toEqual([]);
  });
});
