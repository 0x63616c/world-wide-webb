import { describe, expect, it } from "vitest";

import { fadeProgress } from "../services/schedule-runner-service";

describe("fadeProgress", () => {
  it("is 0 at start", () => expect(fadeProgress(1000, 1000, 60)).toBe(0));
  it("is 0.5 halfway through a 60-min fade", () =>
    expect(fadeProgress(0, 30 * 60_000, 60)).toBe(0.5));
  it("clamps to 1 past the end", () => expect(fadeProgress(0, 120 * 60_000, 60)).toBe(1));
  it("snaps (returns 1) when fadeMinutes<=0", () => expect(fadeProgress(0, 0, 0)).toBe(1));
});
