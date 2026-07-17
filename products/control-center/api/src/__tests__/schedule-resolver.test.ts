import { describe, expect, it } from "vitest";

import { resolveTriggerTime } from "../services/schedule-service";

const midnight = (y: number, m: number, d: number) => new Date(y, m - 1, d, 0, 0, 0);

describe("resolveTriggerTime", () => {
  it("resolves a fixed HH:MM to that wall-clock time on the day", () => {
    const t = resolveTriggerTime({ type: "fixed", time: "21:30" }, midnight(2026, 7, 17), {
      sunriseIso: null,
      sunsetIso: null,
    });
    expect(t).toEqual(new Date(2026, 6, 17, 21, 30, 0));
  });

  it("resolves sunrise minus 30 min from the day's sunrise ISO", () => {
    const t = resolveTriggerTime(
      { type: "sun", event: "sunrise", offsetMin: -30 },
      midnight(2026, 7, 17),
      { sunriseIso: "2026-07-17T05:50", sunsetIso: "2026-07-17T20:40" },
    );
    expect(t).toEqual(new Date(2026, 6, 17, 5, 20, 0));
  });

  it("returns null when a sun trigger has no sun data", () => {
    const t = resolveTriggerTime(
      { type: "sun", event: "sunset", offsetMin: 0 },
      midnight(2026, 7, 17),
      { sunriseIso: null, sunsetIso: null },
    );
    expect(t).toBeNull();
  });
});
