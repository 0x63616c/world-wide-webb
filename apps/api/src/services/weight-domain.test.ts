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
      { day: "2026-07-16", weightKg: 82.2 },
      { day: "2026-07-16", weightKg: 82.0 },
      { day: "2026-07-15", weightKg: 81.9 },
    ];
    expect(dailyMedians(rows)).toEqual([
      { day: "2026-07-15", kg: 81.9 },
      { day: "2026-07-16", kg: 82.1 },
    ]);
  });

  it("trusts the caller's day key rather than re-deriving one", () => {
    // Both readings are the same UTC instant bucketed into different local
    // days — exactly what a timezone boundary produces. The domain must not
    // second-guess the key it was handed.
    const rows = [
      { day: "2026-07-15", weightKg: 80.0 },
      { day: "2026-07-16", weightKg: 90.0 },
    ];
    expect(dailyMedians(rows)).toEqual([
      { day: "2026-07-15", kg: 80.0 },
      { day: "2026-07-16", kg: 90.0 },
    ]);
  });
});

describe("summarize", () => {
  it("low/high come from raw readings, average/change from daily medians", () => {
    const s = summarize(
      [
        { day: "2026-07-15", kg: 82.0 },
        { day: "2026-07-16", kg: 81.0 },
        { day: "2026-07-17", kg: 81.5 },
      ],
      [82.4, 81.6, 80.6, 81.4, 81.6],
    );
    expect(s).toEqual({ low: 80.6, high: 82.4, average: 81.5, change: -0.5 });
  });

  it("a single day still reports a real spread — the shipped bug", () => {
    // Four readings, one day. low/high/average used to collapse to the median.
    const s = summarize([{ day: "2026-07-22", kg: 72.85 }], [72.65, 72.75, 72.95, 73.0]);
    expect(s?.low).toBe(72.65);
    expect(s?.high).toBe(73.0);
    expect(s?.average).toBe(72.85);
    expect(s?.change).toBe(0);
  });

  it("null on empty", () => {
    expect(summarize([], [])).toBeNull();
  });
});
