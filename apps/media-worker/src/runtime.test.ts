/**
 * Tests for the media-worker runtime (www-rw07): structured logging contract.
 * Verifies that the runtime emits the expected log calls on failure transitions,
 * recovery, slow cycles, and stop — without exercising the real pino instance.
 *
 * Uses fake timers. Because each cycle is async, advancing timers alone is not
 * enough — we must also flush the microtask queue between the timer firing and
 * the next setTimeout being scheduled. `tick()` does both.
 */

import type { Logger } from "@repo/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerRuntime } from "./runtime";

// Advance fake timers by `ms` and drain any promises chained off the fired
// callbacks so an await-before-reschedule loop reaches its next setTimeout.
async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

// Build a minimal mock Logger whose methods are spies.
function makeLogger(): Logger {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
    // pino Logger has many other methods; cast to satisfy the type.
  } as unknown as Logger;
  // child() must return a logger with the same spy shape.
  (log.child as ReturnType<typeof vi.fn>).mockReturnValue(log);
  return log;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createWorkerRuntime — basic scheduling (with logger)", () => {
  it("runs runOnStart workers immediately, others after one interval", async () => {
    const eager = vi.fn().mockResolvedValue(undefined);
    const lazy = vi.fn().mockResolvedValue(undefined);
    const rt = createWorkerRuntime(
      [
        { name: "eager", intervalMs: 100, runOnStart: true, run: eager },
        { name: "lazy", intervalMs: 100, run: lazy },
      ],
      { logger: makeLogger() },
    );

    rt.start();
    await tick(0);
    expect(eager).toHaveBeenCalledTimes(1);
    expect(lazy).toHaveBeenCalledTimes(0);

    await tick(100);
    expect(eager).toHaveBeenCalledTimes(2);
    expect(lazy).toHaveBeenCalledTimes(1);

    rt.stop();
  });

  it("throws on duplicate worker names", () => {
    expect(() =>
      createWorkerRuntime(
        [
          { name: "dup", intervalMs: 100, run: vi.fn() },
          { name: "dup", intervalMs: 100, run: vi.fn() },
        ],
        { logger: makeLogger() },
      ),
    ).toThrow(/dup/);
  });
});

describe("createWorkerRuntime — failure transition logging", () => {
  it("logs 'worker entered failing state' on the first failure", async () => {
    const log = makeLogger();
    const run = vi.fn().mockRejectedValueOnce(new Error("first-fail")).mockResolvedValue(undefined);
    const rt = createWorkerRuntime([{ name: "w", intervalMs: 100, runOnStart: true, run }], {
      logger: log,
    });

    rt.start();
    await tick(0); // first cycle — throws

    // child() is called per cycle with the worker name.
    expect(log.child).toHaveBeenCalledWith({ worker: "w" });
    // error log for first failure.
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveFailures: 1 }),
      "worker entered failing state",
    );

    rt.stop();
  });

  it("logs 'worker cycle failed' on subsequent failures", async () => {
    const log = makeLogger();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail-1"))
      .mockRejectedValueOnce(new Error("fail-2"))
      .mockResolvedValue(undefined);
    const rt = createWorkerRuntime([{ name: "w", intervalMs: 100, runOnStart: true, run }], {
      logger: log,
    });

    rt.start();
    await tick(0); // cycle 1 — first failure
    await tick(100); // cycle 2 — second failure

    const calls = (log.error as ReturnType<typeof vi.fn>).mock.calls;
    const messages = calls.map((c) => c[1]);
    expect(messages).toContain("worker entered failing state");
    expect(messages).toContain("worker cycle failed");

    rt.stop();
  });

  it("logs 'worker recovered' when a failing worker succeeds", async () => {
    const log = makeLogger();
    const run = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue(undefined);
    const rt = createWorkerRuntime([{ name: "w", intervalMs: 100, runOnStart: true, run }], {
      logger: log,
    });

    rt.start();
    await tick(0); // first cycle — fails
    await tick(100); // second cycle — succeeds → recovery

    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ clearedStreak: 1 }),
      "worker recovered",
    );

    rt.stop();
  });
});

describe("createWorkerRuntime — stop logging", () => {
  it("logs 'worker runtime stopped' and 'worker final stats' on stop", async () => {
    const log = makeLogger();
    const run = vi.fn().mockResolvedValue(undefined);
    const rt = createWorkerRuntime([{ name: "w", intervalMs: 100, runOnStart: true, run }], {
      logger: log,
    });

    rt.start();
    await tick(0);
    rt.stop();

    const infoCalls = (log.info as ReturnType<typeof vi.fn>).mock.calls;
    const infoMessages = infoCalls.map((c) => c[1]);
    expect(infoMessages).toContain("worker runtime stopped");
    expect(infoMessages).toContain("worker final stats");
  });
});

describe("createWorkerRuntime — slow cycle warning", () => {
  it("logs 'worker cycle exceeded interval' when a cycle takes longer than intervalMs", async () => {
    const log = makeLogger();
    // Simulate a slow run by advancing real time inside the mock.
    const run = vi.fn().mockImplementation(async () => {
      // Advance fake clock during the run so lastDurationMs > intervalMs.
      await vi.advanceTimersByTimeAsync(200);
    });
    const rt = createWorkerRuntime([{ name: "slow", intervalMs: 50, runOnStart: true, run }], {
      logger: log,
    });

    rt.start();
    await tick(0);

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ lastDurationMs: expect.any(Number), intervalMs: 50 }),
      "worker cycle exceeded interval",
    );

    rt.stop();
  });
});

describe("createWorkerRuntime — stats", () => {
  it("tracks runs, duration, failure streak, lastError, and memory", async () => {
    const log = makeLogger();
    const run = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("kaboom"))
      .mockResolvedValue(undefined);
    const rt = createWorkerRuntime([{ name: "w", intervalMs: 100, runOnStart: true, run }], {
      logger: log,
    });

    const before = rt.stats();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      name: "w",
      lastRunAt: null,
      lastDurationMs: null,
      totalRuns: 0,
      consecutiveFailures: 0,
      lastError: null,
      memory: null,
    });

    rt.start();
    await tick(0);
    let s = rt.stats()[0];
    expect(s.totalRuns).toBe(1);
    expect(s.consecutiveFailures).toBe(0);
    expect(s.lastError).toBeNull();
    expect(s.lastRunAt).toBeInstanceOf(Date);
    expect(typeof s.lastDurationMs).toBe("number");
    expect(s.memory).not.toBeNull();

    await tick(100);
    s = rt.stats()[0];
    expect(s.totalRuns).toBe(2);
    expect(s.consecutiveFailures).toBe(1);
    expect(s.lastError).toBe("kaboom");

    await tick(100);
    s = rt.stats()[0];
    expect(s.totalRuns).toBe(3);
    expect(s.consecutiveFailures).toBe(0);
    expect(s.lastError).toBeNull();

    rt.stop();
  });
});
