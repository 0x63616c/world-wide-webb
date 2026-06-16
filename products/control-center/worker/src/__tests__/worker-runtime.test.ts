/**
 * Tests for the worker runtime (www-7d5b.1.1): await-before-reschedule
 * scheduling (no overlap), per-cycle failure isolation (a throwing worker keeps
 * looping and never kills a sibling), per-worker stats, and stop().
 *
 * Uses fake timers. Because each cycle is async, advancing timers alone is not
 * enough , we must also flush the microtask queue between the timer firing and
 * the next setTimeout being scheduled. `tick()` does both.
 */

import type { Logger } from "@www/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkerRuntime } from "../runtime";

// Advance fake timers by `ms` and drain any promises chained off the fired
// callbacks, so an await-before-reschedule loop reaches its next setTimeout.
async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

// Minimal logger stub , records calls so tests can assert on structured log
// output without pulling in pino or a real transport.
function makeLogger() {
  const child = vi.fn().mockReturnThis();
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child,
  } as unknown as Logger;
  return stub;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createWorkerRuntime scheduling", () => {
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

  it("reschedules each cycle only after the previous one resolves (no overlap)", async () => {
    const ctl: { resolveCycle: (() => void) | null } = { resolveCycle: null };
    let concurrent = 0;
    let maxConcurrent = 0;
    const run = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          ctl.resolveCycle = () => {
            concurrent -= 1;
            resolve();
          };
        }),
    );
    const rt = createWorkerRuntime([{ name: "slow", intervalMs: 50, runOnStart: true, run }], {
      logger: makeLogger(),
    });

    rt.start();
    await tick(0);
    expect(run).toHaveBeenCalledTimes(1);

    // Even after several interval's worth of time, no second cycle starts while
    // the first is still pending , the loop awaits before scheduling.
    await tick(500);
    expect(run).toHaveBeenCalledTimes(1);

    // Resolve the in-flight cycle, let the reschedule fire.
    ctl.resolveCycle?.();
    await tick(50);
    expect(run).toHaveBeenCalledTimes(2);
    expect(maxConcurrent).toBe(1);

    ctl.resolveCycle?.();
    rt.stop();
  });
});

describe("failure isolation", () => {
  it("a throwing worker keeps looping and does not kill a sibling", async () => {
    const boom = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom-1"))
      .mockRejectedValueOnce(new Error("boom-2"))
      .mockResolvedValue(undefined);
    const sibling = vi.fn().mockResolvedValue(undefined);
    const rt = createWorkerRuntime(
      [
        { name: "boom", intervalMs: 100, runOnStart: true, run: boom },
        { name: "sibling", intervalMs: 100, runOnStart: true, run: sibling },
      ],
      { logger: makeLogger() },
    );

    rt.start();
    await tick(0);
    expect(boom).toHaveBeenCalledTimes(1);
    expect(sibling).toHaveBeenCalledTimes(1);

    await tick(100);
    expect(boom).toHaveBeenCalledTimes(2);
    expect(sibling).toHaveBeenCalledTimes(2);

    await tick(100);
    expect(boom).toHaveBeenCalledTimes(3);
    expect(sibling).toHaveBeenCalledTimes(3);

    rt.stop();
  });
});

describe("stats", () => {
  it("tracks runs, duration, failure streak, lastError, and memory", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("kaboom"))
      .mockResolvedValue(undefined);
    const rt = createWorkerRuntime([{ name: "w", intervalMs: 100, runOnStart: true, run }], {
      logger: makeLogger(),
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

describe("stop", () => {
  it("halts all workers; no further cycles run", async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    const rt = createWorkerRuntime(
      [
        { name: "a", intervalMs: 100, runOnStart: true, run: a },
        { name: "b", intervalMs: 100, runOnStart: true, run: b },
      ],
      { logger: makeLogger() },
    );

    rt.start();
    await tick(0);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    rt.stop();
    await tick(1000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("a cycle in flight when stop() is called does not reschedule", async () => {
    const ctl: { resolveCycle: (() => void) | null } = { resolveCycle: null };
    const run = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          ctl.resolveCycle = resolve;
        }),
    );
    const rt = createWorkerRuntime([{ name: "w", intervalMs: 100, runOnStart: true, run }], {
      logger: makeLogger(),
    });

    rt.start();
    await tick(0);
    expect(run).toHaveBeenCalledTimes(1);

    rt.stop();
    ctl.resolveCycle?.();
    await tick(1000);
    expect(run).toHaveBeenCalledTimes(1);
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

describe("logging behavior", () => {
  it("logs error on a failing cycle", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("boom"));
    const logger = makeLogger();
    const workerChildLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as Logger;
    (logger.child as ReturnType<typeof vi.fn>).mockReturnValue(workerChildLog);

    const rt = createWorkerRuntime(
      [{ name: "failing", intervalMs: 100, runOnStart: true, run: boom }],
      { logger },
    );

    rt.start();
    await tick(0);

    // Should have logged an error for the failing cycle.
    expect(workerChildLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveFailures: 1 }),
      "worker cycle failed",
    );
    // First failure also logs the onset transition.
    expect(workerChildLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveFailures: 1 }),
      "worker entered failing state",
    );

    rt.stop();
  });

  it("logs recovery when worker succeeds after failures", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValue(undefined);
    const logger = makeLogger();
    const workerChildLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as Logger;
    (logger.child as ReturnType<typeof vi.fn>).mockReturnValue(workerChildLog);

    const rt = createWorkerRuntime([{ name: "flaky", intervalMs: 100, runOnStart: true, run }], {
      logger,
    });

    rt.start();
    await tick(0); // failing cycle
    await tick(100); // recovering cycle

    expect(workerChildLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveFailures: 1 }),
      "worker recovered",
    );

    rt.stop();
  });

  it("logs worker registered on start()", () => {
    const logger = makeLogger();
    const rt = createWorkerRuntime(
      [{ name: "my-worker", intervalMs: 500, run: vi.fn().mockResolvedValue(undefined) }],
      { logger },
    );

    rt.start();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ worker: "my-worker", intervalMs: 500 }),
      "worker registered",
    );

    rt.stop();
  });

  it("logs worker runtime stopped on stop()", async () => {
    const logger = makeLogger();
    const rt = createWorkerRuntime(
      [{ name: "w", intervalMs: 100, runOnStart: true, run: vi.fn().mockResolvedValue(undefined) }],
      { logger },
    );

    rt.start();
    await tick(0);
    rt.stop();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ timersCleared: expect.any(Array) }),
      "worker runtime stopped",
    );
  });
});
