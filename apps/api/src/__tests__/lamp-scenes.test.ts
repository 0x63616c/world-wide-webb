import { describe, expect, it } from "vitest";

import { assignMoodColors, MOOD_PALETTE } from "../config/lamp-scenes";

const key = (c: readonly number[]) => JSON.stringify(c);

describe("MOOD_PALETTE", () => {
  it("holds enough distinct colours for every lamp to be unique", () => {
    const distinct = new Set(MOOD_PALETTE.map(key));
    expect(distinct.size).toBe(MOOD_PALETTE.length); // no dupes in the palette
    expect(MOOD_PALETTE.length).toBeGreaterThanOrEqual(7); // one per lamp (7 lamps)
  });
});

describe("assignMoodColors", () => {
  it("returns one UNIQUE palette colour per lamp", () => {
    const n = 7;
    const colors = assignMoodColors(n);
    expect(colors).toHaveLength(n);

    const palette = new Set(MOOD_PALETTE.map(key));
    for (const c of colors) expect(palette.has(key(c))).toBe(true);

    // The whole ask: every lamp a distinct colour, no repeats.
    expect(new Set(colors.map(key)).size).toBe(n);
  });

  it("is driven by the injected rng — same stream is reproducible, different stream can reorder", () => {
    const seq = (vals: number[]) => {
      let i = 0;
      return () => vals[i++ % vals.length];
    };

    const a1 = assignMoodColors(6, seq([0.1, 0.4, 0.7, 0.2, 0.9, 0.5]));
    const a2 = assignMoodColors(6, seq([0.1, 0.4, 0.7, 0.2, 0.9, 0.5]));
    expect(a1.map(key)).toEqual(a2.map(key)); // deterministic given the rng

    const b = assignMoodColors(6, seq([0.9, 0.1, 0.5, 0.8, 0.2, 0.6]));
    // A different rng stream should be able to produce a different ordering.
    expect(b.map(key)).not.toEqual(a1.map(key));
  });
});
