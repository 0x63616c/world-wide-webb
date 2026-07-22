/**
 * Alarm store contract: the nextFireAtMs firing authority (local wall-clock
 * Date rolling, DST-aware), ring-until-dismissed, and boot missed-alarm
 * resolution. TZ is pinned non-UTC so every wall-clock computation exercises a
 * real offset , America/New_York also supplies the spring-forward case.
 */

// biome-ignore lint/style/noProcessEnv: TZ must be pinned non-UTC BEFORE any Date use so the wall-clock math under test runs against a real offset (and the spring-forward case exists at all); Node re-reads TZ live, so this is the one sanctioned mechanism.
process.env.TZ = "America/New_York";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Pure helpers are side-effect-free , static imports, unaffected by the
// freshStore() module resets below.
import { computeNextFireAtMs, nextFireDescription, validRepeatDays } from "../pure";
import type { AlarmRecord } from "../types";
import { installMemoryLocalStorage } from "./memory-local-storage";

const playCue = vi.hoisted(() => vi.fn());
const warmAudio = vi.hoisted(() => vi.fn());
vi.mock("../../sound", () => ({ playCue, warmAudio }));

type AlarmStore = typeof import("../alarm-store");

// Monday 2026-07-20, 10:00 local.
const BASE = new Date(2026, 6, 20, 10, 0, 0).getTime();
const STORAGE_KEY = "cc-alarms-v1";

let store: AlarmStore;

async function freshStore(): Promise<AlarmStore> {
  vi.resetModules();
  return await import("../alarm-store");
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
  installMemoryLocalStorage();
  playCue.mockClear();
  warmAudio.mockClear();
  store = await freshStore();
});

afterEach(() => {
  store.resetAlarmsForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function alarms() {
  return store._alarmStateForTests().alarms;
}

function firing() {
  return store._alarmStateForTests().firing;
}

function storedAlarm(overrides: Partial<AlarmRecord>): AlarmRecord {
  return {
    id: "alarm_fixed",
    label: null,
    hour: 7,
    minute: 30,
    repeatDays: [],
    enabled: true,
    nextFireAtMs: null,
    ...overrides,
  };
}

describe("computeNextFireAtMs", () => {
  const oneShot = (hour: number, minute: number) => ({ hour, minute, repeatDays: [] as number[] });

  it("one-shot later today resolves to today", () => {
    const next = computeNextFireAtMs(oneShot(12, 30), BASE) as number;
    const d = new Date(next);
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(30);
  });

  it("one-shot earlier today rolls to tomorrow (strictly after now)", () => {
    const next = computeNextFireAtMs(oneShot(9, 0), BASE) as number;
    const d = new Date(next);
    expect(d.getDate()).toBe(21);
    expect(d.getHours()).toBe(9);
  });

  it("an alarm set for exactly now schedules the NEXT occurrence", () => {
    const next = computeNextFireAtMs(oneShot(10, 0), BASE) as number;
    expect(next).toBeGreaterThan(BASE);
    expect(new Date(next).getDate()).toBe(21);
  });

  it("weekday repeat rolls forward to the next matching day", () => {
    // From Monday 10:00 to Wednesday 7:30.
    const next = computeNextFireAtMs({ hour: 7, minute: 30, repeatDays: [3] }, BASE) as number;
    const d = new Date(next);
    expect(d.getDay()).toBe(3); // Wed
    expect(d.getDate()).toBe(22);
    expect(d.getHours()).toBe(7);
  });

  it("Sunday (ISO 7) wraps across the JS day-0 seam", () => {
    const next = computeNextFireAtMs({ hour: 8, minute: 0, repeatDays: [7] }, BASE) as number;
    const d = new Date(next);
    expect(d.getDay()).toBe(0); // JS Sunday
    expect(d.getDate()).toBe(26);
  });

  it("spring-forward: a 02:30 alarm on the skipped night resolves to the adjusted instant", () => {
    // US DST starts 2026-03-08 02:00 (America/New_York): 02:30 does not exist.
    const midnight = new Date(2026, 2, 8, 0, 0, 0).getTime();
    const next = computeNextFireAtMs(oneShot(2, 30), midnight) as number;
    const d = new Date(next);
    expect(next).toBeGreaterThan(midnight);
    expect(d.getDate()).toBe(8);
    // The skipped wall time lands on the DST-adjusted instant (iOS-matching).
    expect(d.getHours()).toBe(3);
    expect(d.getMinutes()).toBe(30);
  });
});

describe("repeatDays validation", () => {
  it("validRepeatDays pins the ISO 1-7 deduped contract", () => {
    expect(validRepeatDays([])).toBe(true);
    expect(validRepeatDays([1, 7])).toBe(true);
    expect(validRepeatDays([1, 2, 3, 4, 5, 6, 7])).toBe(true);
    expect(validRepeatDays([0])).toBe(false);
    expect(validRepeatDays([8])).toBe(false);
    expect(validRepeatDays([1.5])).toBe(false);
    expect(validRepeatDays([3, 3])).toBe(false);
  });

  it("computeNextFireAtMs returns null when no day can ever match", () => {
    expect(computeNextFireAtMs({ hour: 7, minute: 30, repeatDays: [0] }, BASE)).toBeNull();
    expect(computeNextFireAtMs({ hour: 7, minute: 30, repeatDays: [8] }, BASE)).toBeNull();
  });

  it("addAlarm rejects out-of-range repeatDays", () => {
    store.addAlarm({ hour: 10, minute: 1, repeatDays: [0, 3] });
    expect(alarms()).toHaveLength(0);
  });

  it("updateAlarm keeps the record unchanged on invalid repeatDays", () => {
    store.addAlarm({ hour: 10, minute: 1, repeatDays: [3] });
    const before = alarms()[0];
    store.updateAlarm(before.id, { repeatDays: [9] });
    expect(alarms()[0]).toEqual(before);
  });

  it("stored records with invalid repeatDays are dropped at load", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, alarms: [storedAlarm({ repeatDays: [0, 3] })], firing: null }),
    );
    store.resetAlarmsForTests();
    store = await freshStore();
    expect(alarms()).toHaveLength(0);
  });
});

describe("firing", () => {
  it("fires at the deadline: firing set, cue played, one-shot disabled", () => {
    store.addAlarm({ hour: 10, minute: 1 });
    expect(warmAudio).toHaveBeenCalled();
    expect(playCue).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(playCue).toHaveBeenCalledWith("alarmFire");
    const initialCalls = playCue.mock.calls.length;
    expect(firing()).toEqual({ alarmId: alarms()[0].id, sinceMs: BASE + 60_000 });
    expect(alarms()[0].enabled).toBe(false);
    expect(alarms()[0].nextFireAtMs).toBeNull();

    // No double-fire: the deadline nulled at fire time; only the 5 s nag replays.
    vi.advanceTimersByTime(250);
    expect(playCue.mock.calls.length).toBe(initialCalls);
  });

  it("a repeat rolls its deadline forward at fire time and stays enabled", () => {
    store.addAlarm({ hour: 10, minute: 1, repeatDays: [1, 2, 3, 4, 5, 6, 7] });
    vi.advanceTimersByTime(60_000);
    const a = alarms()[0];
    expect(a.enabled).toBe(true);
    expect(a.nextFireAtMs).toBe(computeNextFireAtMs(a, BASE + 60_000));
    expect(a.nextFireAtMs as number).toBeGreaterThan(BASE + 60_000);
  });

  it("replays the cue every 5 s while ringing and auto-stops after 10 min", () => {
    store.addAlarm({ hour: 10, minute: 1 });
    vi.advanceTimersByTime(60_000);
    const initialCalls = playCue.mock.calls.length;
    vi.advanceTimersByTime(5_000);
    expect(playCue.mock.calls.length).toBeGreaterThan(initialCalls);

    vi.advanceTimersByTime(10 * 60_000);
    expect(firing()).toBeNull();
    const atStop = playCue.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(playCue.mock.calls.length).toBe(atStop);
  });

  it("dismissAlarmFiring stops the ringing", () => {
    store.addAlarm({ hour: 10, minute: 1 });
    vi.advanceTimersByTime(60_000);
    store.dismissAlarmFiring();
    expect(firing()).toBeNull();
    const calls = playCue.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(playCue.mock.calls.length).toBe(calls);
  });

  it("a disabled alarm never fires (and holds no ticker)", () => {
    store.addAlarm({ hour: 10, minute: 1 });
    store.toggleAlarm(alarms()[0].id, false);
    expect(alarms()[0].nextFireAtMs).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(playCue).not.toHaveBeenCalled();
    expect(firing()).toBeNull();
  });

  it("re-enabling recomputes the deadline from now", () => {
    store.addAlarm({ hour: 10, minute: 1 });
    const id = alarms()[0].id;
    store.toggleAlarm(id, false);
    vi.advanceTimersByTime(2 * 60_000); // 10:02 , past the wall time
    store.toggleAlarm(id, true);
    const a = alarms()[0];
    expect(a.nextFireAtMs).toBe(computeNextFireAtMs(a, Date.now()));
    expect(a.nextFireAtMs as number).toBeGreaterThan(Date.now());
  });
});

describe("boot missed-alarm handling", () => {
  it("missed within the 60 s grace window fires normally at load", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        alarms: [storedAlarm({ nextFireAtMs: BASE - 30_000 })],
        firing: null,
      }),
    );
    store.resetAlarmsForTests();
    playCue.mockClear();
    store = await freshStore();

    expect(playCue).toHaveBeenCalledWith("alarmFire");
    expect(firing()).toEqual({ alarmId: "alarm_fixed", sinceMs: BASE });
    // One-shot: fired means spent.
    expect(alarms()[0].enabled).toBe(false);
  });

  it("a stale one-shot disables silently , no 24-h-late blares", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        alarms: [storedAlarm({ nextFireAtMs: BASE - 2 * 60 * 60_000 })],
        firing: null,
      }),
    );
    store.resetAlarmsForTests();
    playCue.mockClear();
    store = await freshStore();

    expect(playCue).not.toHaveBeenCalled();
    expect(firing()).toBeNull();
    expect(alarms()[0].enabled).toBe(false);
    expect(alarms()[0].nextFireAtMs).toBeNull();
  });

  it("a stale repeat rolls forward without a cue", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        alarms: [
          storedAlarm({ repeatDays: [1, 2, 3, 4, 5, 6, 7], nextFireAtMs: BASE - 2 * 60 * 60_000 }),
        ],
        firing: null,
      }),
    );
    store.resetAlarmsForTests();
    playCue.mockClear();
    store = await freshStore();

    expect(playCue).not.toHaveBeenCalled();
    const a = alarms()[0];
    expect(a.enabled).toBe(true);
    expect(a.nextFireAtMs as number).toBeGreaterThan(BASE);
  });
});

describe("nextFireDescription", () => {
  const at = (overrides: Partial<AlarmRecord>) => storedAlarm(overrides);

  it("phrases the standard shapes", () => {
    expect(nextFireDescription(at({ enabled: false }), BASE)).toBe("Off");
    expect(nextFireDescription(at({ repeatDays: [1, 2, 3, 4, 5, 6, 7] }), BASE)).toBe(
      "Every day, 7:30 AM",
    );
    expect(nextFireDescription(at({ repeatDays: [1, 2, 3, 4, 5] }), BASE)).toBe(
      "Weekdays, 7:30 AM",
    );
    expect(nextFireDescription(at({ repeatDays: [6, 7] }), BASE)).toBe("Weekends, 7:30 AM");
    expect(nextFireDescription(at({ repeatDays: [3, 1] }), BASE)).toBe("Mon Wed, 7:30 AM");
  });

  it("one-shots read Today/Tomorrow off the deadline", () => {
    // 7:30 already passed at BASE (10:00) , tomorrow.
    const passed = at({ nextFireAtMs: computeNextFireAtMs(at({}), BASE) });
    expect(nextFireDescription(passed, BASE)).toBe("Tomorrow, 7:30 AM");

    const later = at({ hour: 22, minute: 0 });
    const laterWithNext = {
      ...later,
      nextFireAtMs: computeNextFireAtMs(later, BASE),
    };
    expect(nextFireDescription(laterWithNext, BASE)).toBe("Today, 10:00 PM");
  });
});
