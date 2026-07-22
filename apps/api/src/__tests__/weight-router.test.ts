import { describe, expect, it } from "vitest";
import { assembleDays, tzInput } from "../trpc/routers/weight";

describe("tzInput", () => {
  it("accepts a real zone", () => {
    expect(tzInput.parse("America/Los_Angeles")).toBe("America/Los_Angeles");
  });
  it("rejects an unknown zone", () => {
    expect(() => tzInput.parse("Mars/Olympus")).toThrow();
  });
  it("rejects a SQL injection attempt", () => {
    expect(() => tzInput.parse("UTC'; drop table weight_measurement; --")).toThrow();
  });
});

describe("assembleDays", () => {
  const rows = [
    {
      id: "wm_3",
      day: "2026-07-22",
      measuredAt: new Date("2026-07-22T18:43:00Z"),
      weightKg: 72.65,
      excludedReason: null,
    },
    {
      id: "wm_2",
      day: "2026-07-22",
      measuredAt: new Date("2026-07-22T16:55:00Z"),
      weightKg: 72.95,
      excludedReason: null,
    },
    {
      id: "wm_1",
      day: "2026-07-21",
      measuredAt: new Date("2026-07-21T15:40:00Z"),
      weightKg: 73.1,
      excludedReason: null,
    },
  ];

  it("groups newest day first with medians and day-over-day deltas", () => {
    const days = assembleDays(rows);
    expect(days.map((d) => d.day)).toEqual(["2026-07-22", "2026-07-21"]);
    expect(days[0]?.medianKg).toBeCloseTo(72.8);
    // vs the previous RECORDED day, which may not be yesterday.
    expect(days[0]?.dayDeltaKg).toBeCloseTo(-0.3);
    // The oldest day in the page has nothing before it.
    expect(days[1]?.dayDeltaKg).toBeNull();
  });

  it("readings are newest first and delta compares to the previous included one", () => {
    const [today] = assembleDays(rows);
    expect(today?.readings.map((r) => r.id)).toEqual(["wm_3", "wm_2"]);
    expect(today?.readings[0]?.deltaKg).toBeCloseTo(-0.3);
    expect(today?.readings[1]?.deltaKg).toBeNull();
  });

  it("excluded readings are listed but do not move the median", () => {
    const withGuest = [
      {
        id: "wm_x",
        day: "2026-07-22",
        measuredAt: new Date("2026-07-22T15:00:00Z"),
        weightKg: 95,
        excludedReason: "sanity_band",
      },
      ...rows,
    ];
    const [today] = assembleDays(withGuest);
    expect(today?.readings).toHaveLength(3);
    expect(today?.medianKg).toBeCloseTo(72.8);
  });
});
