import { describe, expect, it, vi } from "vitest";

import {
  GITHUB_RUN_RETENTION_MS,
  githubRunCutoff,
  purgeGithubRuns,
  runShouldPurge,
} from "../services/github-purge-service";

describe("github run retention boundary", () => {
  const now = new Date("2026-07-18T12:00:00Z");

  it("keeps a run inside the 30-day window and purges one past it", () => {
    const inside = { startedAtUtc: new Date(now.getTime() - GITHUB_RUN_RETENTION_MS + 1000) };
    const outside = { startedAtUtc: new Date(now.getTime() - GITHUB_RUN_RETENTION_MS - 1000) };
    expect(runShouldPurge(inside, now)).toBe(false);
    expect(runShouldPurge(outside, now)).toBe(true);
  });

  it("cutoff is exactly 30 days before now", () => {
    expect(now.getTime() - githubRunCutoff(now).getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("purgeGithubRuns", () => {
  it("deletes expired log tails and runs, and never touches github_poll_status", async () => {
    const statements: string[] = [];
    const db = {
      execute: vi.fn(async (q: { queryChunks?: unknown }) => {
        // Drizzle sql`` fragments carry their text in queryChunks; flatten for
        // a table-name assertion.
        statements.push(JSON.stringify(q));
        return { rowCount: 2 };
      }),
    };
    const counts = await purgeGithubRuns(db as never, new Date("2026-07-18T12:00:00Z"));
    expect(counts).toEqual({ runs: 2, logTails: 2 });
    expect(db.execute).toHaveBeenCalledTimes(2);
    const all = statements.join(" ");
    expect(all).toContain("github_run_log_tail");
    expect(all).toContain("github_run");
    // The deployed-pointer singleton must survive every sweep.
    expect(all).not.toContain("github_poll_status");
  });
});
