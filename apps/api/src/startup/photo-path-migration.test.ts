import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wakePhoto } from "@features/wakes/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migratePhotoPaths } from "./photo-path-migration";

type Row = { id: string | null; path: string; capturedAt: Date };

/**
 * Pull the bound value out of a drizzle `eq(col, value)` condition. Matched by
 * constructor: the surrounding StringChunks carry a `value` key too, so a
 * duck-typed search finds the SQL fragment instead of the parameter.
 */
function boundValue(
  // biome-ignore lint/suspicious/noExplicitAny: reaches into drizzle's SQL internals
  where: any,
): string {
  // biome-ignore lint/suspicious/noExplicitAny: reaches into drizzle's SQL internals
  const param = where.queryChunks.find((c: any) => c?.constructor?.name === "Param");
  return param.value;
}

/**
 * Minimal drizzle stand-in (mirrors wake-photo-service.test.ts): the migration
 * only selects legacy-shaped rows and updates one path at a time, so the
 * harness implements exactly that. Both operations key off the real table
 * object the service passes, so the harness cannot drift from the query.
 */
function createMockDb(wake: Row[], booth: Row[]) {
  const rowsFor = (t: unknown) => (t === wakePhoto ? wake : booth);

  const db = {
    wake,
    booth,
    select: (_cols: unknown) => ({
      from: (t: unknown) => ({
        // Stands in for `like(path, '%/%')`: legacy paths are the ones with a
        // directory separator.
        where: (_w: unknown) => Promise.resolve(rowsFor(t).filter((r) => r.path.includes("/"))),
      }),
    }),
    update: (t: unknown) => ({
      set: (vals: { path: string }) => ({
        where: (w: unknown) => {
          const match = boundValue(w);
          const row = rowsFor(t).find((r) => (t === wakePhoto ? r.path : r.id) === match);
          if (row) row.path = vals.path;
          return Promise.resolve({ rowCount: row ? 1 : 0 });
        },
      }),
    }),
  };
  // biome-ignore lint: test harness stands in for NodePgDatabase<typeof schema>
  return db as any;
}

const TS = Date.UTC(2026, 5, 1, 14, 28, 6, 155); // 1780324086155

async function writeLegacy(root: string, rel: string, body: string) {
  const dir = join(root, rel.split("/").slice(0, -1).join("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(root, rel), body);
}

describe("photo-path-migration", () => {
  let wakeRoot: string;
  let boothRoot: string;

  beforeEach(async () => {
    wakeRoot = await mkdtemp(join(tmpdir(), "wake-migrate-"));
    boothRoot = await mkdtemp(join(tmpdir(), "booth-migrate-"));
  });
  afterEach(async () => {
    await rm(wakeRoot, { recursive: true, force: true });
    await rm(boothRoot, { recursive: true, force: true });
  });

  it("renames indexed photos to flat ISO names and rewrites their rows", async () => {
    await writeLegacy(wakeRoot, "2026/06/01/1780324086155-0.jpg", "wake-bytes");
    await writeLegacy(boothRoot, "2026/06/01/1780324086155-0.jpg", "booth-bytes");
    const db = createMockDb(
      [{ id: null, path: "2026/06/01/1780324086155-0.jpg", capturedAt: new Date(TS) }],
      [{ id: "bph_1", path: "2026/06/01/1780324086155-0.jpg", capturedAt: new Date(TS) }],
    );

    const res = await migratePhotoPaths(db, wakeRoot, boothRoot);

    expect(res).toEqual({ wake: 1, booth: 1, orphans: 0 });
    expect(db.wake[0].path).toBe("2026-06-01T14-28-06.155Z-0.jpg");
    expect(db.booth[0].path).toBe("2026-06-01T14-28-06.155Z-0.jpg");
    // Bytes moved, not copied or lost.
    expect(await readFile(join(wakeRoot, db.wake[0].path), "utf8")).toBe("wake-bytes");
    expect(await readFile(join(boothRoot, db.booth[0].path), "utf8")).toBe("booth-bytes");
  });

  it("keeps same-millisecond photos distinct by carrying the legacy suffix across", async () => {
    await writeLegacy(wakeRoot, "2026/06/01/1780324086155-0.jpg", "first");
    await writeLegacy(wakeRoot, "2026/06/01/1780324086155-1.jpg", "second");
    const db = createMockDb(
      [
        { id: null, path: "2026/06/01/1780324086155-0.jpg", capturedAt: new Date(TS) },
        { id: null, path: "2026/06/01/1780324086155-1.jpg", capturedAt: new Date(TS) },
      ],
      [],
    );

    await migratePhotoPaths(db, wakeRoot, boothRoot);

    expect(db.wake.map((r: Row) => r.path)).toEqual([
      "2026-06-01T14-28-06.155Z-0.jpg",
      "2026-06-01T14-28-06.155Z-1.jpg",
    ]);
    expect(await readFile(join(wakeRoot, "2026-06-01T14-28-06.155Z-0.jpg"), "utf8")).toBe("first");
    expect(await readFile(join(wakeRoot, "2026-06-01T14-28-06.155Z-1.jpg"), "utf8")).toBe("second");
  });

  it("preserves a gif's extension", async () => {
    await writeLegacy(boothRoot, "2026/06/01/1780324086155-0.gif", "gif-bytes");
    const db = createMockDb(
      [],
      [{ id: "bph_1", path: "2026/06/01/1780324086155-0.gif", capturedAt: new Date(TS) }],
    );

    await migratePhotoPaths(db, wakeRoot, boothRoot);

    expect(db.booth[0].path).toBe("2026-06-01T14-28-06.155Z-0.gif");
  });

  it("sweeps unindexed legacy files and removes the emptied dated tree", async () => {
    await writeLegacy(wakeRoot, "2026/06/01/1780324086155-0.jpg", "orphan");

    const res = await migratePhotoPaths(createMockDb([], []), wakeRoot, boothRoot);

    expect(res.orphans).toBe(1);
    expect(await readdir(wakeRoot)).toEqual(["2026-06-01T14-28-06.155Z-0.jpg"]);
  });

  it("is idempotent , a second run is a no-op", async () => {
    await writeLegacy(wakeRoot, "2026/06/01/1780324086155-0.jpg", "wake-bytes");
    const db = createMockDb(
      [{ id: null, path: "2026/06/01/1780324086155-0.jpg", capturedAt: new Date(TS) }],
      [],
    );

    await migratePhotoPaths(db, wakeRoot, boothRoot);
    const second = await migratePhotoPaths(db, wakeRoot, boothRoot);

    expect(second).toEqual({ wake: 0, booth: 0, orphans: 0 });
    expect(await readdir(wakeRoot)).toEqual(["2026-06-01T14-28-06.155Z-0.jpg"]);
  });

  it("finishes a run interrupted between the file move and the row update", async () => {
    // File already at its destination, row still pointing at the legacy path.
    await writeFile(join(wakeRoot, "2026-06-01T14-28-06.155Z-0.jpg"), "wake-bytes");
    const db = createMockDb(
      [{ id: null, path: "2026/06/01/1780324086155-0.jpg", capturedAt: new Date(TS) }],
      [],
    );

    const res = await migratePhotoPaths(db, wakeRoot, boothRoot);

    expect(res.wake).toBe(1);
    expect(db.wake[0].path).toBe("2026-06-01T14-28-06.155Z-0.jpg");
  });

  it("leaves a row alone when its bytes are missing rather than pointing it elsewhere", async () => {
    const db = createMockDb(
      [{ id: null, path: "2026/06/01/1780324086155-0.jpg", capturedAt: new Date(TS) }],
      [],
    );

    const res = await migratePhotoPaths(db, wakeRoot, boothRoot);

    expect(res.wake).toBe(0);
    expect(db.wake[0].path).toBe("2026/06/01/1780324086155-0.jpg");
  });

  it("skips a legacy name it does not recognise instead of guessing a timestamp", async () => {
    await writeLegacy(wakeRoot, "2026/06/01/IMG_0042.jpg", "unknown");
    const db = createMockDb(
      [{ id: null, path: "2026/06/01/IMG_0042.jpg", capturedAt: new Date(TS) }],
      [],
    );

    const res = await migratePhotoPaths(db, wakeRoot, boothRoot);

    expect(res.wake).toBe(0);
    expect(db.wake[0].path).toBe("2026/06/01/IMG_0042.jpg");
    expect(await readFile(join(wakeRoot, "2026/06/01/IMG_0042.jpg"), "utf8")).toBe("unknown");
  });
});
