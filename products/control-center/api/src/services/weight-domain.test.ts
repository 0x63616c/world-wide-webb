import { describe, expect, it } from "vitest";
import { dailyMedians, isOutsideSanityBand, median, summarize } from "./weight-domain";

describe("median", () => {
  it("odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("isOutsideSanityBand", () => {
  const recent = [81.6, 81.8, 82.0, 82.2];
  it("passes normal readings", () => {
    expect(isOutsideSanityBand(81.0, recent)).toBe(false);
  });
  it("flags a guest 15kg away", () => {
    expect(isOutsideSanityBand(97.0, recent)).toBe(true);
  });
  it("inactive with fewer than 3 prior readings", () => {
    expect(isOutsideSanityBand(97.0, [81.6, 81.8])).toBe(false);
  });
});

describe("dailyMedians", () => {
  it("reduces same-day multiples to the median and sorts by day", () => {
    const rows = [
      { measuredAt: new Date("2026-07-16T07:41:00Z"), weightKg: 82.2 },
      { measuredAt: new Date("2026-07-16T07:44:00Z"), weightKg: 82.0 },
      { measuredAt: new Date("2026-07-15T07:19:00Z"), weightKg: 81.9 },
    ];
    expect(dailyMedians(rows)).toEqual([
      { day: "2026-07-15", kg: 81.9 },
      { day: "2026-07-16", kg: 82.1 },
    ]);
  });
});

describe("summarize", () => {
  it("low/high/average/change over the window", () => {
    const s = summarize([
      { day: "2026-07-15", kg: 82.0 },
      { day: "2026-07-16", kg: 81.0 },
      { day: "2026-07-17", kg: 81.5 },
    ]);
    expect(s).toEqual({ low: 81.0, high: 82.0, average: 81.5, change: -0.5 });
  });
  it("null on empty", () => {
    expect(summarize([])).toBeNull();
  });
});
