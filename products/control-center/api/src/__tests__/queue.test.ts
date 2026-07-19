/**
 * Unit tests for the generic job queue (www-kp4k.12).
 * Tests: single-flight claim (SKIP LOCKED semantics mocked), retry+backoff,
 * dispatch-by-type, max_attempts→failed.
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
import { _clearHandlersForTest, claimAndRun, enqueueJob, registerHandler } from "../jobs/queue";

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
  _clearHandlersForTest();
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

describe("claimAndRun , empty queue", () => {
  it("returns false when no jobs are claimable", async () => {
    const result = await claimAndRun();
    expect(result).toBe(false);
  });

  it("issues the FOR UPDATE SKIP LOCKED claim query", async () => {
    await claimAndRun();
    expect(logContains("SKIP LOCKED")).toBe(true);
  });
});

describe("claimAndRun , type filter", () => {
  it("adds a type filter to the claim query when types are given", async () => {
    await claimAndRun({ types: ["notify"] });
    expect(logContains("type IN")).toBe(true);
  });

  it("omits the type filter entirely when no types are given", async () => {
    await claimAndRun();
    expect(logContains("type IN")).toBe(false);
  });

  it("claims nothing (and issues no query) for an empty type list", async () => {
    // A process with no registered types must not claim the whole queue by
    // accident , the guard is what stops an empty list meaning "everything".
    const result = await claimAndRun({ types: [] });
    expect(result).toBe(false);
    expect(logContains("SKIP LOCKED")).toBe(false);
  });
});

describe("claimAndRun , dispatch by type", () => {
  it("calls the handler registered for the job type", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerHandler("test_job", handler);
    mockState.claimedRow = makeRow({ type: "test_job", payload: { hello: "world" } });

    await claimAndRun();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ hello: "world" });
  });

  it("returns true when a job was claimed and processed", async () => {
    registerHandler("test_job", vi.fn().mockResolvedValue(undefined));
    mockState.claimedRow = makeRow();
    const result = await claimAndRun();
    expect(result).toBe(true);
  });

  it("marks the job done (issues UPDATE with 'done') on handler success", async () => {
    registerHandler("test_job", vi.fn().mockResolvedValue(undefined));
    mockState.claimedRow = makeRow();
    await claimAndRun();

    // The log should contain a SQL fragment with 'done'.
    expect(logContains("done")).toBe(true);
    // Must not have issued a permanent 'failed' update.
    expect(logContains("failed")).toBe(false);
  });

  it("permanently fails (issues UPDATE with 'failed') when no handler is registered", async () => {
    mockState.claimedRow = makeRow({ type: "unknown_type" });
    await claimAndRun();

    expect(logContains("failed")).toBe(true);
    expect(logContains("done")).toBe(false);
  });
});

describe("claimAndRun , retry + backoff", () => {
  it("requeues (issues UPDATE with 'queued' + run_after) when handler throws and has retries", async () => {
    registerHandler("test_job", vi.fn().mockRejectedValue(new Error("transient")));
    // attempts=0, max_attempts=5 → after this attempt (1), still 4 left.
    mockState.claimedRow = makeRow({ attempts: 0, max_attempts: 5 });
    await claimAndRun();

    // Should re-queue, not permanently fail.
    expect(logContains("run_after")).toBe(true);
    expect(logContains("failed")).toBe(false);
    expect(logContains("done")).toBe(false);
  });

  it("permanently fails when handler throws and attempts are exhausted", async () => {
    registerHandler("test_job", vi.fn().mockRejectedValue(new Error("permanent")));
    // attempts=4 → after this attempt (5) = max_attempts → permanently fail.
    mockState.claimedRow = makeRow({ attempts: 4, max_attempts: 5 });
    await claimAndRun();

    expect(logContains("failed")).toBe(true);
    expect(logContains("done")).toBe(false);
  });

  it("does not mark done when handler throws", async () => {
    registerHandler("test_job", vi.fn().mockRejectedValue(new Error("boom")));
    mockState.claimedRow = makeRow({ attempts: 0, max_attempts: 5 });
    await claimAndRun();

    expect(logContains("done")).toBe(false);
  });
});

describe("registerHandler", () => {
  it("throws if the same type is registered twice", () => {
    const handler = vi.fn();
    registerHandler("dupe_type", handler);
    expect(() => registerHandler("dupe_type", handler)).toThrow(
      "Handler already registered for type: dupe_type",
    );
  });
});
