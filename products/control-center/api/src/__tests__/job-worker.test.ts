/**
 * Unit tests for the JobSpec → Worker bridge.
 *
 * `jobWorker` is asserted against a mocked `claimOne`: its whole job is to hand
 * its spec's three fields to the claim, so mocking the claim is what makes that
 * delegation visible. `reapStaleJobs` owns real SQL, so it runs against the same
 * mocked-db style queue.test.ts uses , we read the emitted SQL text rather than
 * standing up a Postgres.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobWorker, reapStaleJobs, staleJobReaper } from "../jobs/job-worker";

const noop = async () => {};

// ── mocks ────────────────────────────────────────────────────────────────────

const queueMock = vi.hoisted(() => ({
  claims: [] as Array<{ type: string; maxMs: number }>,
}));

vi.mock("../jobs/queue", () => ({
  claimOne: vi.fn(async (type: string, _handler: unknown, maxMs: number) => {
    queueMock.claims.push({ type, maxMs });
    return true;
  }),
}));

const dbMock = vi.hoisted(() => ({
  /** SQL text of every execute(), in order. */
  executeLog: [] as string[],
  /** rowCount returned by the next execute() calls, shifted one per call. */
  rowCounts: [] as number[],
}));

/** Recursively collect string content from a drizzle SQL object (see queue.test.ts). */
function sqlText(frag: unknown): string {
  if (typeof frag === "string") return frag;
  if (typeof frag === "number" || typeof frag === "boolean") return String(frag);
  if (typeof frag !== "object" || frag === null) return "";
  if ("value" in frag) {
    const v = (frag as { value: unknown }).value;
    if (Array.isArray(v)) return v.join("");
    if (typeof v === "string") return v;
  }
  if ("queryChunks" in frag && Array.isArray((frag as { queryChunks: unknown[] }).queryChunks)) {
    return (frag as { queryChunks: unknown[] }).queryChunks.map(sqlText).join("");
  }
  return "";
}

vi.mock("../db/index", () => ({
  db: {
    execute: async (frag: unknown) => {
      dbMock.executeLog.push(sqlText(frag));
      return { rows: [], rowCount: dbMock.rowCounts.shift() ?? 0 };
    },
  },
}));

beforeEach(() => {
  queueMock.claims = [];
  dbMock.executeLog = [];
  dbMock.rowCounts = [];
});

// ── tests ────────────────────────────────────────────────────────────────────

describe("jobWorker", () => {
  it("names the worker after its job type", () => {
    const w = jobWorker({ type: "notify", handler: noop, maxMs: 1000 });
    expect(w.name).toBe("job:notify");
  });

  it("polls every 2s and runs on start", () => {
    const w = jobWorker({ type: "notify", handler: noop, maxMs: 1000 });
    expect(w.intervalMs).toBe(2000);
    expect(w.runOnStart).toBe(true);
  });

  it("claims only its own type, with its own maxMs, when its cycle runs", async () => {
    const w = jobWorker({ type: "notify", handler: noop, maxMs: 60_000 });
    await w.run();
    expect(queueMock.claims).toEqual([{ type: "notify", maxMs: 60_000 }]);
  });

  it("gives each type an independent worker, so one cannot claim another's rows", async () => {
    const ingest = jobWorker({ type: "youtube_ingest", handler: noop, maxMs: 3_600_000 });
    await ingest.run();
    expect(queueMock.claims).toEqual([{ type: "youtube_ingest", maxMs: 3_600_000 }]);
  });
});

describe("reapStaleJobs", () => {
  const specs = [{ type: "youtube_ingest", handler: noop, maxMs: 60_000 }];

  it("only ever requeues rows already at status='running'", async () => {
    // Prod-safety: the parked youtube_ingest backlog sits at `queued`. A reaper
    // that touched `queued` rows would unpark 93 downloads.
    dbMock.rowCounts = [0];
    await reapStaleJobs(specs);
    const [sqlIssued] = dbMock.executeLog;
    expect(sqlIssued).toContain("status = 'running'");
    expect(sqlIssued).toContain("SET status = 'queued'");
  });

  it("scopes the sweep to the spec's own type and its lease", async () => {
    dbMock.rowCounts = [0];
    await reapStaleJobs(specs);
    const [sqlIssued] = dbMock.executeLog;
    expect(sqlIssued).toContain("youtube_ingest");
    expect(sqlIssued).toContain("locked_at <");
    // maxMs (60s) + the 5 minute grace, in seconds.
    expect(sqlIssued).toContain("360");
  });

  it("returns the number of rows requeued", async () => {
    dbMock.rowCounts = [3];
    expect(await reapStaleJobs(specs)).toBe(3);
  });

  it("returns 0 when nothing is stranded", async () => {
    dbMock.rowCounts = [0];
    expect(await reapStaleJobs(specs)).toBe(0);
  });

  it("issues one sweep per spec and sums them", async () => {
    dbMock.rowCounts = [1, 2];
    const reaped = await reapStaleJobs([
      { type: "notify", handler: noop, maxMs: 60_000 },
      { type: "youtube_ingest", handler: noop, maxMs: 3_600_000 },
    ]);
    expect(dbMock.executeLog).toHaveLength(2);
    expect(reaped).toBe(3);
  });

  it("sweeps nothing when given no specs", async () => {
    expect(await reapStaleJobs([])).toBe(0);
    expect(dbMock.executeLog).toHaveLength(0);
  });
});

describe("staleJobReaper", () => {
  it("is a 5 minute worker", () => {
    const w = staleJobReaper([{ type: "notify", handler: noop, maxMs: 1000 }]);
    expect(w.name).toBe("stale-job-reaper");
    expect(w.intervalMs).toBe(5 * 60_000);
  });

  it("sweeps every spec it was built from on each cycle", async () => {
    dbMock.rowCounts = [0, 0];
    const w = staleJobReaper([
      { type: "notify", handler: noop, maxMs: 1000 },
      { type: "youtube_ingest", handler: noop, maxMs: 1000 },
    ]);
    await w.run();
    expect(dbMock.executeLog).toHaveLength(2);
  });
});
