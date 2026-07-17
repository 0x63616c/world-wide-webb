import { describe, expect, it } from "vitest";

import { newScheduleId } from "../services/schedule-service";

describe("newScheduleId", () => {
  it("prefixes ids with sched_", () => {
    expect(newScheduleId()).toMatch(/^sched_[A-Za-z0-9-]+$/);
  });
  it("is unique across calls", () => {
    expect(newScheduleId()).not.toBe(newScheduleId());
  });
});
