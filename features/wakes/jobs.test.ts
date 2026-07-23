import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { purgeWakePhotos, WAKE_PHOTO_RETENTION_MS, wakePhotoCutoff } from "./jobs";

// ─── minimal in-memory db harness: only the query surface the purge calls ────

type Row = { path: string; capturedAt: Date };

function createMockDb(initial: Row[]) {
  let rows = [...initial];

  const db = {
    get rows() {
      return rows;
    },
    select: (_cols: unknown) => ({
      from: (_table: unknown) => ({
        where: (_w: unknown) => ({
          orderBy: (_o: unknown) => ({
            limit: (n: number) => {
              // The mock can't evaluate the drizzle predicate; the test drives
              // cutoff behavior by construction (see cutoffFilter below).
              return Promise.resolve(
                rows
                  .filter((r) => r.capturedAt.getTime() < db.cutoffMs)
                  .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
                  .slice(0, n)
                  .map((r) => ({ path: r.path })),
              );
            },
          }),
        }),
      }),
    }),
    delete: (_table: unknown) => ({
      where: (_w: unknown) => {
        // The purge deletes by path immediately after selecting it; mirror that
        // by removing the oldest matching row.
        const doomed = rows
          .filter((r) => r.capturedAt.getTime() < db.cutoffMs)
          .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())[0];
        rows = rows.filter((r) => r !== doomed);
        return Promise.resolve();
      },
    }),
    cutoffMs: 0,
  };

  // biome-ignore lint: test harness stands in for NodePgDatabase<typeof schema>
  return db as any;
}

function jpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
}

describe("wake-photo-purge-service", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wake-purge-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("cutoff is retention before now", () => {
    const now = new Date(Date.UTC(2026, 6, 18, 12, 0, 0));
    expect(wakePhotoCutoff(now).getTime()).toBe(now.getTime() - WAKE_PHOTO_RETENTION_MS);
  });

  it("deletes rows and their files past the retention window, keeping recent ones", async () => {
    const now = new Date(Date.UTC(2026, 6, 18, 12, 0, 0));
    const old = Date.UTC(2026, 3, 1, 12, 0, 0); // >90 days before now
    const recent = Date.UTC(2026, 6, 17, 12, 0, 0);

    const oldPath = join("2026", "04", "01", `${old}-0.jpg`);
    const recentPath = join("2026", "07", "17", `${recent}-0.jpg`);
    for (const p of [oldPath, recentPath]) {
      await mkdir(join(root, p, ".."), { recursive: true });
      await writeFile(join(root, p), jpeg());
    }

    const db = createMockDb([
      { path: oldPath, capturedAt: new Date(old) },
      { path: recentPath, capturedAt: new Date(recent) },
    ]);
    db.cutoffMs = wakePhotoCutoff(now).getTime();

    const res = await purgeWakePhotos(db, root, now);
    expect(res).toEqual({ photos: 1, truncated: false });

    await expect(stat(join(root, oldPath))).rejects.toThrow();
    await expect(stat(join(root, recentPath))).resolves.toBeTruthy();
    expect(db.rows.map((r: { path: string }) => r.path)).toEqual([recentPath]);
  });

  it("tolerates rows whose file is already gone", async () => {
    const now = new Date(Date.UTC(2026, 6, 18, 12, 0, 0));
    const old = Date.UTC(2026, 3, 1, 12, 0, 0);
    const db = createMockDb([
      { path: join("2026", "04", "01", `${old}-0.jpg`), capturedAt: new Date(old) },
    ]);
    db.cutoffMs = wakePhotoCutoff(now).getTime();

    const res = await purgeWakePhotos(db, root, now);
    expect(res).toEqual({ photos: 1, truncated: false });
    expect(db.rows).toHaveLength(0);
  });

  it("nothing to purge is a clean zero", async () => {
    const db = createMockDb([]);
    db.cutoffMs = 0;
    const res = await purgeWakePhotos(db, root);
    expect(res).toEqual({ photos: 0, truncated: false });
  });
});
