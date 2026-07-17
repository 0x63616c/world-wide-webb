/**
 * Integration test for the schedule-runner cycle (www-sched). Proves the whole
 * path UP TO (not including) Home Assistant: a due schedule fires and writes the
 * correct desired state onto each target's device_state row, and the schedule is
 * stamped fired-today. db is mocked (no Postgres, no light-enforcer), so no real
 * bulb is ever touched — the enforcer, which this test never runs, is the only
 * thing that calls HA.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── mock DB (chainable builder keyed by table) ───────────────────────────────

const { mockDbSelect, mockDbInsert, mockDbUpdate, state } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  state: {
    schedules: [] as unknown[],
    deviceRows: [] as unknown[],
    weatherRows: [] as unknown[],
    desiredWrites: [] as Array<Record<string, unknown>>,
    scheduleUpdates: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../db/index", () => ({
  db: { select: mockDbSelect, insert: mockDbInsert, update: mockDbUpdate },
}));

// ─── import after mocks ───────────────────────────────────────────────────────

import { lightSchedules, weatherDailyReading } from "../db/schema";
import { runScheduleRunnerCycle } from "../services/schedule-runner-service";

// A chainable, awaitable select builder. from(table) picks which array resolves.
function makeSelectBuilder() {
  const b: Record<string, unknown> = {};
  let table: unknown;
  const resolve = () => {
    if (table === lightSchedules) return state.schedules;
    if (table === weatherDailyReading) return state.weatherRows;
    return state.deviceRows; // deviceState (and anything else)
  };
  b.from = (t: unknown) => {
    table = t;
    return b;
  };
  b.where = () => b;
  b.orderBy = () => b;
  b.limit = () => b;
  b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onF, onR);
  return b;
}

beforeEach(() => {
  state.schedules = [];
  state.deviceRows = [];
  state.weatherRows = [];
  state.desiredWrites = [];
  state.scheduleUpdates = [];

  mockDbSelect.mockImplementation(() => makeSelectBuilder());

  // db.insert(deviceState).values(v).onConflictDoUpdate(...) — capture v.
  mockDbInsert.mockImplementation(() => ({
    values: (v: Record<string, unknown>) => {
      state.desiredWrites.push(v);
      return { onConflictDoUpdate: () => Promise.resolve() };
    },
  }));

  // db.update(lightSchedules).set(s).where(...) — capture s.
  mockDbUpdate.mockImplementation(() => ({
    set: (s: Record<string, unknown>) => {
      state.scheduleUpdates.push(s);
      return { where: () => Promise.resolve() };
    },
  }));

  vi.useFakeTimers();
  // Friday 2026-07-17, 21:35 local — just past a 21:30 fixed trigger.
  vi.setSystemTime(new Date(2026, 6, 17, 21, 35, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runScheduleRunnerCycle", () => {
  it("fires a due schedule and writes red desired for each target, no HA call", async () => {
    state.schedules = [
      {
        id: "sched_test",
        name: "Red night",
        enabled: true,
        days: [0, 1, 2, 3, 4, 5, 6],
        trigger: { type: "fixed", time: "21:30" },
        action: { on: true, scene: "red" }, // snap (no fade)
        targetIds: ["living-globe", "kitchen-lamp"], // non-bedroom lamps
        lastFiredDate: null,
      },
    ];

    await runScheduleRunnerCycle();

    // One desired write per target, on + pure red.
    const byEntity = new Map(state.desiredWrites.map((w) => [w.entityId, w]));
    expect(byEntity.size).toBe(2);
    for (const entityId of ["light.living_room_globe", "light.kitchen_lamp"]) {
      const w = byEntity.get(entityId) as Record<string, unknown> | undefined;
      expect(w, `write for ${entityId}`).toBeTruthy();
      expect(w!.desiredState).toMatchObject({ on: true, color: { rgb: [255, 0, 0] } });
    }

    // Schedule stamped fired-today so it won't re-fire.
    expect(state.scheduleUpdates.some((u) => u.lastFiredDate === "2026-07-17")).toBe(true);
  });
});
