/**
 * Tests for the shared integration-heartbeat + command-window modules extracted
 * from the enforcer/sync services. Mocks the DB to verify the failure-streak
 * read-modify-write and the runCycle success/failure branches.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── mock DB ──────────────────────────────────────────────────────────────────

const { mockDbSelect, mockDbInsert } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
}));

vi.mock("../db/index", () => ({
  db: { select: mockDbSelect, insert: mockDbInsert },
}));

// ─── import after mocks ──────────────────────────────────────────────────────

import { COMMAND_WINDOW_MS, stampCommandWindow, windowOpen } from "../services/command-window";
import { heartbeat, runCycle } from "../services/integration-heartbeat";

// select({ n }).from().where().limit() -> the prior streak row.
function streakChain(rows: { n: number }[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

// insert().values().onConflictDoUpdate() -> capture the upserted values.
function insertBuilder() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  mockDbInsert.mockReturnValue({ values });
  return { values, onConflictDoUpdate };
}

describe("command-window", () => {
  it("COMMAND_WINDOW_MS is 10s", () => {
    expect(COMMAND_WINDOW_MS).toBe(10_000);
  });

  it("stampCommandWindow returns now + the window", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(stampCommandWindow(now).getTime()).toBe(now.getTime() + COMMAND_WINDOW_MS);
  });

  it("windowOpen is true only while now is before a set desiredUntilUtc", () => {
    const now = new Date("2026-01-01T00:00:05Z");
    expect(windowOpen({ desiredUntilUtc: new Date("2026-01-01T00:00:10Z") }, now)).toBe(true);
    expect(windowOpen({ desiredUntilUtc: new Date("2026-01-01T00:00:01Z") }, now)).toBe(false);
    expect(windowOpen({ desiredUntilUtc: null }, now)).toBe(false);
  });
});

describe("integration-heartbeat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("ok() upserts lastError null and resets the streak to 0 without reading", async () => {
    const { values } = insertBuilder();

    await heartbeat("light-enforcer").ok();

    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: "light-enforcer",
        lastError: null,
        consecutiveFailures: 0,
      }),
    );
  });

  it("fail() increments the prior streak and returns the new value", async () => {
    mockDbSelect.mockReturnValue(streakChain([{ n: 2 }]));
    const { values } = insertBuilder();

    const streak = await heartbeat("weather").fail("HA down");

    expect(streak).toBe(3);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: "weather",
        lastError: "HA down",
        consecutiveFailures: 3,
      }),
    );
  });

  it("fail() treats a missing prior row as streak 0 (first failure -> 1)", async () => {
    mockDbSelect.mockReturnValue(streakChain([]));
    insertBuilder();

    expect(await heartbeat("weather").fail("boom")).toBe(1);
  });
});

describe("runCycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs the work and marks the heartbeat ok on success", async () => {
    const { values } = insertBuilder();
    const work = vi.fn().mockResolvedValue(undefined);

    await runCycle(heartbeat("device-sync"), "device-sync", work);

    expect(work).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ lastError: null, consecutiveFailures: 0 }),
    );
  });

  it("swallows a work failure and records it as a heartbeat failure", async () => {
    mockDbSelect.mockReturnValue(streakChain([{ n: 1 }]));
    const { values } = insertBuilder();
    const work = vi.fn().mockRejectedValue(new Error("kaboom"));

    await expect(runCycle(heartbeat("device-sync"), "device-sync", work)).resolves.toBeUndefined();

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ lastError: "kaboom", consecutiveFailures: 2 }),
    );
  });
});
