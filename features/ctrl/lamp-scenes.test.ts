import { describe, expect, it } from "vitest";

import {
  assignMoodColors,
  BLUE_RGB,
  LAMP_MODE_SPEED_CONFIG,
  LampModeSpeed,
  MOOD_PALETTE,
  PARTY_PALETTE,
  partyColorsAtTick,
  RED_RGB,
  WHITE_SCENE_KELVIN,
} from "./lamp-scenes";

const key = (c: readonly number[]) => JSON.stringify(c);

describe("MOOD_PALETTE", () => {
  it("holds enough distinct colors for every lamp to be unique", () => {
    const distinct = new Set(MOOD_PALETTE.map(key));
    expect(distinct.size).toBe(MOOD_PALETTE.length); // no dupes in the palette
    expect(MOOD_PALETTE.length).toBeGreaterThanOrEqual(7); // one per lamp (7 lamps)
  });

  it("stays disjoint from RED_RGB/BLUE_RGB , activeScene='mood' detection relies on it (www-vhht)", () => {
    const palette = new Set(MOOD_PALETTE.map(key));
    expect(palette.has(key(RED_RGB))).toBe(false);
    expect(palette.has(key(BLUE_RGB))).toBe(false);
  });
});

describe("assignMoodColors", () => {
  it("returns one UNIQUE palette color per lamp", () => {
    const n = 7;
    const colors = assignMoodColors(n);
    expect(colors).toHaveLength(n);

    const palette = new Set(MOOD_PALETTE.map(key));
    for (const c of colors) expect(palette.has(key(c))).toBe(true);

    // The whole ask: every lamp a distinct color, no repeats.
    expect(new Set(colors.map(key)).size).toBe(n);
  });

  it("is driven by the injected rng , same stream is reproducible, different stream can reorder", () => {
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

describe("WHITE_SCENE_KELVIN", () => {
  it("is the warmer 4000K (down a notch from the old cold 5000K)", () => {
    expect(WHITE_SCENE_KELVIN).toBe(4000);
  });
});

describe("LAMP_MODE_SPEED_CONFIG", () => {
  it("has a config per speed with Hue-safe intervals and 2x ratio between steps", () => {
    expect(LAMP_MODE_SPEED_CONFIG[LampModeSpeed.Fast].intervalMs).toBe(4000);
    expect(LAMP_MODE_SPEED_CONFIG[LampModeSpeed.Slow].intervalMs).toBeGreaterThan(
      LAMP_MODE_SPEED_CONFIG[LampModeSpeed.Medium].intervalMs,
    );
    expect(LAMP_MODE_SPEED_CONFIG[LampModeSpeed.Medium].intervalMs).toBeGreaterThan(
      LAMP_MODE_SPEED_CONFIG[LampModeSpeed.Fast].intervalMs,
    );
    // transition stays under the interval so each fade settles before the next tick
    for (const speed of Object.values(LampModeSpeed)) {
      const { intervalMs, transitionS } = LAMP_MODE_SPEED_CONFIG[speed];
      expect(transitionS * 1000).toBeLessThan(intervalMs);
    }
  });
});

describe("partyColorsAtTick", () => {
  it("gives one color per lamp, each drawn from PARTY_PALETTE", () => {
    const colors = partyColorsAtTick(0, 7);
    expect(colors).toHaveLength(7);
    const palette = new Set(PARTY_PALETTE.map(key));
    for (const c of colors) expect(palette.has(key(c))).toBe(true);
  });

  it("phase-offsets adjacent lamps by one palette step at tick 0", () => {
    const colors = partyColorsAtTick(0, PARTY_PALETTE.length);
    expect(colors.map(key)).toEqual(PARTY_PALETTE.map(key));
  });

  it("advances every lamp by one color each tick (rolling wave)", () => {
    const n = PARTY_PALETTE.length;
    const t0 = partyColorsAtTick(0, n);
    const t1 = partyColorsAtTick(1, n);
    // lamp i at tick 1 == lamp i+1 at tick 0 (the wave shifts by one)
    for (let i = 0; i < n; i++) {
      expect(key(t1[i])).toBe(key(t0[(i + 1) % n]));
    }
  });

  it("wraps mod-N and is deterministic (same tick → same colors)", () => {
    const n = PARTY_PALETTE.length;
    expect(partyColorsAtTick(n, 4).map(key)).toEqual(partyColorsAtTick(0, 4).map(key));
    expect(partyColorsAtTick(5, 7).map(key)).toEqual(partyColorsAtTick(5, 7).map(key));
  });
});
