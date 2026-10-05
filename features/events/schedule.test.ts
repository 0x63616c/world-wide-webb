import { describe, expect, it } from "vitest";
import { alarmInputSchema } from "./contract";
import { alarmOnDate, dueAlarmPlan, nextAlarmAt } from "./schedule";

const schedule = (patch = {}) =>
  alarmInputSchema.parse({ time: "09:00", timeZone: "America/Los_Angeles", ...patch });
const next = (after: string, patch = {}) =>
  nextAlarmAt(schedule(patch), new Date(after))?.toISOString();

describe("alarm calendar", () => {
  it("resolves date picker input in the selected zone, rejecting DST gaps", () => {
    expect(alarmOnDate("2026-10-05", "09:00", "America/Los_Angeles")?.toISOString()).toBe(
      "2026-10-05T16:00:00.000Z",
    );
    expect(alarmOnDate("2026-03-08", "02:30", "America/Los_Angeles")).toBeNull();
  });
  it("uses the alarm zone, not the process or phone zone", () => {
    expect(next("2026-10-05T15:00:00Z")).toBe("2026-10-05T16:00:00.000Z");
    expect(next("2026-10-05T16:00:00Z")).toBe("2026-10-06T16:00:00.000Z");
  });
  it("finds the next selected weekday across month/year boundaries", () => {
    expect(next("2026-12-31T18:00:00Z", { repeatDays: [1] })).toBe("2027-01-04T17:00:00.000Z");
  });
  it("skips nonexistent spring-forward wall times", () => {
    expect(next("2026-03-08T08:00:00Z", { time: "02:30" })).toBe("2026-03-09T09:30:00.000Z");
    expect(next("2026-03-08T08:00:00Z", { time: "02:30", repeatDays: [0] })).toBe(
      "2026-03-15T09:30:00.000Z",
    );
  });
  it("fires once, at the first instance, during fall-back", () => {
    expect(next("2026-11-01T07:00:00Z", { time: "01:30" })).toBe("2026-11-01T08:30:00.000Z");
    expect(next("2026-11-01T08:45:00Z", { time: "01:30" })).toBe("2026-11-02T09:30:00.000Z");
  });
  it("handles non-hour offsets and half-hour DST", () => {
    expect(next("2026-10-05T00:00:00Z", { timeZone: "Asia/Kathmandu" })).toBe(
      "2026-10-05T03:15:00.000Z",
    );
    expect(next("2026-10-03T12:00:00Z", { timeZone: "Australia/Lord_Howe", time: "02:15" })).toBe(
      "2026-10-04T15:15:00.000Z",
    );
  });
  it("accepts an absolute Shortcut date and rejects past instants", () => {
    expect(next("2026-10-05T00:00:00Z", { at: "2026-10-08T09:00:00-07:00" })).toBe(
      "2026-10-08T16:00:00.000Z",
    );
    expect(next("2026-10-09T00:00:00Z", { at: "2026-10-08T09:00:00-07:00" })).toBeUndefined();
  });
  it("deduplicates repeat days and rejects malformed schedules", () => {
    expect(schedule({ repeatDays: [5, 1, 1] }).repeatDays).toEqual([1, 5]);
    for (const patch of [
      { time: "25:00" },
      { timeZone: "Invalid/Zone" },
      { repeatDays: [7] },
      { snoozeMinutes: 0 },
      { lightTarget: "script.erase" },
      { at: "2026-10-08T16:00:00Z", repeatDays: [1] },
    ]) {
      expect(() => schedule(patch)).toThrow();
    }
  });
  it("recovers a recent alarm but skips old backlog and advances repeating alarms", () => {
    const alarm = {
      ...schedule({ repeatDays: [1, 2, 3, 4, 5] }),
      nextFireAt: new Date("2026-10-05T16:00:00Z"),
    };
    expect(dueAlarmPlan(alarm, new Date("2026-10-05T16:14:00Z")).ring).toBe(true);
    const plan = dueAlarmPlan(alarm, new Date("2026-10-07T18:00:00Z"));
    expect(plan.ring).toBe(false);
    expect(plan.nextFireAt?.toISOString()).toBe("2026-10-08T16:00:00.000Z");
  });
  it("recovers today's repetition within the grace window after a multi-day outage", () => {
    const plan = dueAlarmPlan(
      {
        ...schedule({ repeatDays: [1, 2, 3, 4, 5] }),
        nextFireAt: new Date("2026-10-05T16:00:00Z"),
      },
      new Date("2026-10-07T16:10:00Z"),
    );
    expect(plan.ring).toBe(true);
    expect(plan.scheduledAt.toISOString()).toBe("2026-10-07T16:00:00.000Z");
    expect(plan.nextFireAt?.toISOString()).toBe("2026-10-08T16:00:00.000Z");
  });
});
