/**
 * Unit tests for the generic job queue (www-kp4k.12).
 * Tests: single-flight claim (SKIP LOCKED semantics mocked), single-type claim,
 * the run_after gate, retry+backoff, max_attempts→failed, and the per-job
 * timeout (both the AbortSignal and the promise race that backs it).
 *
 * The DB is fully mocked , no real Postgres needed. We instrument execute()
 * to capture which branch (done/queued/failed) was taken by looking for the
 * literal status strings in the SQL object's raw query chunks.
 *
 * Design note: drizzle sql`` objects have a `queryChunks` array containing
 * `SQLRaw` (strings) and `Param` (values). Status literals like 'done' live
 * in the SQLRaw chunks. We walk them to find the terminal status branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimOne, enqueueJob } from "../jobs/queue";

// ── DB mock ───────────────────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  claimedRow: null as {
    id: number;
    type: string;
    payload: unknown;
    attempts: number;
    max_attempts: number;
  } | null,
  // Flat log of UPDATE sql frag objects (after the claim SELECT).
  executeLog: [] as unknown[],
  inserts: [] as Array<Record<string, unknown>>,
}));

/**
 * Recursively collect all string content from a drizzle SQL object.
 * Structure (from drizzle-orm source):
 *   SQL object: { queryChunks: Array<SQLRaw | Param | SQL | number | ...> }
 *   SQLRaw:     { value: string[] }   ← array of string literals
 *   Param:      bare primitive (number, string, Date, ...)
 */
function sqlText(frag: unknown): string {
  if (typeof frag === "string") return frag;
  if (typeof frag === "number" || typeof frag === "boolean") return String(frag);
  if (frag instanceof Date) return frag.toISOString();
  if (typeof frag !== "object" || frag === null) return "";

  // SQLRaw: { value: string[] }
  if ("value" in frag) {
    const v = (frag as { value: unknown }).value;
    if (Array.isArray(v)) return v.join("");
    if (typeof v === "string") return v;
  }

  // SQL composite: { queryChunks: [...] }
  if ("queryChunks" in frag && Array.isArray((frag as { queryChunks: unknown[] }).queryChunks)) {
    return (frag as { queryChunks: unknown[] }).queryChunks.map(sqlText).join("");
  }
  return "";
}

type MockDb = {
  transaction: (fn: (tx: MockDb) => Promise<unknown>) => Promise<unknown>;
  execute: (sqlFrag: unknown) => Promise<{ rows: unknown[] }>;
  insert: (_table: unknown) => {
    values: (row: Record<string, unknown>) => {
      returning: (_fields: unknown) => Promise<Array<{ id: number }>>;
      onConflictDoNothing: () => {
        returning: (_fields: unknown) => Promise<Array<{ id: number }>>;
      };
    };
  };
};

vi.mock("../db/index", () => {
  const db: MockDb = {
    transaction: async (fn: (tx: MockDb) => Promise<unknown>) => fn(db),

    execute: async (sqlFrag: unknown) => {
      const text = sqlText(sqlFrag);
      mockState.executeLog.push(text);

      // The claim SELECT returns the queued row.
      if (text.includes("SKIP LOCKED")) {
        return { rows: mockState.claimedRow ? [mockState.claimedRow] : [] };
      }
      return { rows: [] };
    },

    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        mockState.inserts.push(row);
        return {
          returning: (_fields: unknown) => Promise.resolve([{ id: mockState.inserts.length }]),
          onConflictDoNothing: () => ({
            returning: (_fields: unknown) => Promise.resolve([{ id: 1 }]),
          }),
        };
      },
    }),
  };
  return { db };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(
  overrides: Partial<{
    id: number;
    type: string;
    payload: unknown;
    attempts: number;
    max_attempts: number;
  }> = {},
) {
  return {
    id: 1,
    type: "test_job",
    payload: { x: 1 },
    attempts: 0,
    max_attempts: 5,
    ...overrides,
  };
}

/** True if any logged SQL text contains the given keyword. */
function logContains(keyword: string): boolean {
  return (mockState.executeLog as string[]).some(
    (s) => typeof s === "string" && s.includes(keyword),
  );
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockState.claimedRow = null;
  mockState.executeLog = [];
  mockState.inserts = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("enqueueJob", () => {
  it("inserts a job row and returns its id", async () => {
    const id = await enqueueJob("my_job", { foo: "bar" });
    expect(id).toBeGreaterThan(0);
    expect(mockState.inserts).toHaveLength(1);
    expect(mockState.inserts[0]).toMatchObject({ type: "my_job" });
  });

  it("accepts priority and runAfter options", async () => {
    const future = new Date(Date.now() + 60_000);
    await enqueueJob("my_job", {}, { priority: 5, runAfter: future, maxAttempts: 3 });
    expect(mockState.inserts[0]).toMatchObject({
      priority: 5,
      runAfter: future,
      maxAttempts: 3,
    });
  });
});

describe("claimOne , empty queue", () => {
  it("returns false when no job of that type is queued", async () => {
    const result = await claimOne("notify", async () => {}, 1000);
    expect(result).toBe(false);
  });

  it("issues the FOR UPDATE SKIP LOCKED claim query", async () => {
    await claimOne("notify", async () => {}, 1000);
    expect(logContains("SKIP LOCKED")).toBe(true);
  });
});

describe("claimOne , single-type claim", () => {
  it("restricts the claim to the requested type", async () => {
    await claimOne("notify", async () => {}, 1000);
    expect(logContains("type =")).toBe(true);
    expect(logContains("notify")).toBe(true);
  });

  it("never claims a job whose run_after is in the future", async () => {
    // Prod-safety: the youtube_ingest backlog is parked on run_after. Dropping
    // this predicate would immediately start 93 downloads.
    await claimOne("youtube_ingest", async () => {}, 1000);
    expect(logContains("run_after <= now()")).toBe(true);
  });
});

describe("claimOne , dispatch", () => {
  it("calls the handler with the payload and an AbortSignal", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    mockState.claimedRow = makeRow({ type: "notify", payload: { hello: "world" } });

    const result = await claimOne("notify", handler, 1000);

    expect(result).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toEqual({ hello: "world" });
    expect(handler.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
  });

  it("marks the job done on handler success", async () => {
    mockState.claimedRow = makeRow({ type: "notify" });
    await claimOne("notify", async () => {}, 1000);

    expect(logContains("done")).toBe(true);
    expect(logContains("failed")).toBe(false);
  });
});

describe("claimOne , retry + backoff", () => {
  it("requeues with backoff when the handler throws and retries remain", async () => {
    mockState.claimedRow = makeRow({ type: "notify", attempts: 0, max_attempts: 5 });
    await claimOne(
      "notify",
      async () => {
        throw new Error("transient");
      },
      1000,
    );

    expect(logContains("run_after")).toBe(true);
    expect(logContains("transient")).toBe(true);
    expect(logContains("failed")).toBe(false);
    expect(logContains("done")).toBe(false);
  });

  it("permanently fails once attempts reach max_attempts", async () => {
    mockState.claimedRow = makeRow({ type: "notify", attempts: 0, max_attempts: 1 });
    await claimOne(
      "notify",
      async () => {
        throw new Error("permanent");
      },
      1000,
    );

    expect(logContains("failed")).toBe(true);
    expect(logContains("done")).toBe(false);
  });
});

describe("claimOne , timeout", () => {
  it("fails the job when the handler exceeds maxMs", async () => {
    mockState.claimedRow = makeRow({ type: "notify", attempts: 0, max_attempts: 1 });
    await claimOne("notify", () => new Promise((resolve) => setTimeout(resolve, 5_000)), 50);

    expect(logContains("failed")).toBe(true);
    expect(logContains("timed out")).toBe(true);
    expect(logContains("done")).toBe(false);
  });

  it("aborts the signal it passes to the handler on timeout", async () => {
    mockState.claimedRow = makeRow({ type: "notify", attempts: 0, max_attempts: 1 });
    let aborted = false;
    await claimOne(
      "notify",
      (_payload, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
          setTimeout(resolve, 5_000);
        }),
      50,
    );

    expect(aborted).toBe(true);
  });

  it("does not leave a timer running after a fast handler", async () => {
    mockState.claimedRow = makeRow({ type: "notify" });
    const signals: AbortSignal[] = [];
    await claimOne(
      "notify",
      async (_payload, signal) => {
        signals.push(signal);
      },
      50,
    );
    // The race timer is cleared in `finally`; the signal stays unaborted.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(signals[0]?.aborted).toBe(false);
  });
});
