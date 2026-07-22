import { describe, expect, it } from "vitest";
import {
  averageWindow,
  cardinalDeviation,
  formatTilt,
  isLevel,
  normalizeDegrees,
  pitchFromGravity,
  tiltFromGravity,
} from "./tilt";

const G = 9.81;
// Gravity reading for a device whose right side has DROPPED by `deg`
// (device rotated clockwise as seen from the front), in portrait.
function gravityRightSideLow(deg: number): { gx: number; gy: number } {
  const rad = (deg * Math.PI) / 180;
  return { gx: G * Math.sin(rad), gy: -G * Math.cos(rad) };
}

describe("tiltFromGravity", () => {
  it("reads 0 for an upright, level portrait device", () => {
    expect(tiltFromGravity(0, -G, 0)).toBeCloseTo(0, 5);
  });

  it("is negative when the right side is low", () => {
    const { gx, gy } = gravityRightSideLow(3);
    expect(tiltFromGravity(gx, gy, 0)).toBeCloseTo(-3, 5);
  });

  it("is positive when the right side is high", () => {
    const { gx, gy } = gravityRightSideLow(-2.5);
    expect(tiltFromGravity(gx, gy, 0)).toBeCloseTo(2.5, 5);
  });

  it("compensates for the rendered screen orientation", () => {
    // Same physical reading, screen rotated 90°: the roll shifts by 90°.
    const { gx, gy } = gravityRightSideLow(3);
    const portrait = tiltFromGravity(gx, gy, 0);
    const landscape = tiltFromGravity(gx, gy, 90);
    expect(portrait).not.toBeNull();
    expect(landscape).toBeCloseTo(normalizeDegrees((portrait as number) + 90), 5);
  });

  it("returns null when the device lies flat", () => {
    expect(tiltFromGravity(0.05, -0.08, 0)).toBeNull();
  });
});

describe("cardinalDeviation", () => {
  it("passes small angles through", () => {
    expect(cardinalDeviation(0)).toBe(0);
    expect(cardinalDeviation(2.3)).toBeCloseTo(2.3, 5);
    expect(cardinalDeviation(-1.7)).toBeCloseTo(-1.7, 5);
  });

  it("reads mount error relative to a quarter-turn, not the quarter-turn itself", () => {
    // The landscape-mounted panel whose roll comes back offset by 90°.
    expect(cardinalDeviation(90)).toBe(0);
    expect(cardinalDeviation(90.4)).toBeCloseTo(0.4, 5);
    expect(cardinalDeviation(-89.6)).toBeCloseTo(0.4, 5);
    expect(cardinalDeviation(180)).toBe(0);
    expect(cardinalDeviation(-90)).toBe(0);
  });
});

describe("normalizeDegrees", () => {
  it("wraps into (-180, 180]", () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(190)).toBe(-170);
    expect(normalizeDegrees(-190)).toBe(170);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(360)).toBe(0);
  });
});

describe("formatTilt", () => {
  it("shows a signed one-decimal degree", () => {
    expect(formatTilt(0.42)).toBe("+0.4°");
    expect(formatTilt(-2.14)).toBe("-2.1°");
  });

  it("drops the trailing .0", () => {
    expect(formatTilt(3.04)).toBe("+3°");
  });

  it("snaps to 0° inside the flat zone", () => {
    expect(formatTilt(0.1)).toBe("0°");
    expect(formatTilt(-0.1)).toBe("0°");
  });
});

describe("isLevel", () => {
  it("is true only inside the flat zone", () => {
    expect(isLevel(0.1)).toBe(true);
    expect(isLevel(-0.1)).toBe(true);
    expect(isLevel(0.2)).toBe(false);
  });
});

describe("averageWindow", () => {
  it("returns null for an empty window", () => {
    expect(averageWindow([], 1000, 250)).toBe(null);
  });

  it("averages every sample inside the window", () => {
    const samples = [
      { t: 900, angle: 1 },
      { t: 950, angle: 2 },
      { t: 1000, angle: 3 },
    ];
    expect(averageWindow(samples, 1000, 250)).toBe(2);
  });

  it("drops samples that have aged out, in place", () => {
    const samples = [
      { t: 100, angle: 40 },
      { t: 900, angle: 1 },
      { t: 1000, angle: 3 },
    ];
    expect(averageWindow(samples, 1000, 250)).toBe(2);
    expect(samples).toHaveLength(2);
  });

  it("returns null once every sample has aged out", () => {
    const samples = [{ t: 100, angle: 40 }];
    expect(averageWindow(samples, 1000, 250)).toBe(null);
    expect(samples).toHaveLength(0);
  });

  it("smooths jitter that per-reading publishing would expose", () => {
    const samples = [-0.5, 0.5, -0.4, 0.4].map((angle, i) => ({ t: 1000 + i * 10, angle }));
    expect(averageWindow(samples, 1040, 250)).toBeCloseTo(0, 5);
  });
});

describe("pitchFromGravity", () => {
  it("reads 0 for a panel hanging flush against the wall", () => {
    expect(pitchFromGravity(0, -G, 0)).toBeCloseTo(0, 5);
  });

  it("is positive when the panel leans back, top away from the viewer", () => {
    // Leaning back by `deg` swings gravity out of the screen plane toward +z.
    const deg = 10;
    const rad = (deg * Math.PI) / 180;
    expect(pitchFromGravity(0, -G * Math.cos(rad), G * Math.sin(rad))).toBeCloseTo(deg, 5);
  });

  it("is negative when the panel leans forward, top toward the viewer", () => {
    const rad = (10 * Math.PI) / 180;
    expect(pitchFromGravity(0, -G * Math.cos(rad), -G * Math.sin(rad))).toBeCloseTo(-10, 5);
  });

  it("reads +90 lying face-up on a table", () => {
    expect(pitchFromGravity(0, 0, G)).toBeCloseTo(90, 5);
  });

  it("ignores rotation within the screen plane (no screenAngle needed)", () => {
    const rad = (10 * Math.PI) / 180;
    const gz = G * Math.sin(rad);
    const inPlane = G * Math.cos(rad);
    // Same lean, panel rolled 90 degrees within the wall: pitch is unchanged.
    expect(pitchFromGravity(0, -inPlane, gz)).toBeCloseTo(pitchFromGravity(inPlane, 0, gz) ?? 0, 5);
  });

  it("returns null for a reading with no usable magnitude", () => {
    expect(pitchFromGravity(0, 0, 0)).toBe(null);
  });
});
