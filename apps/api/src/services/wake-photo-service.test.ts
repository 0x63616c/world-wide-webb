import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  backfillWakePhotoIndex,
  listWakePhotos,
  readWakePhoto,
  saveWakePhoto,
  type WakePhotoMeta,
} from "./wake-photo-service";

// Minimal valid-enough JPEG body: SOI marker prefix + payload.
function jpeg(payload = "x"): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, ...new TextEncoder().encode(payload)]);
}

// ─── minimal in-memory db harness (mirrors booth-photo-service.test.ts: a
// plain object implementing only the drizzle surface this service calls) ─────

type WakePhotoRow = {
  path: string;
  capturedAt: Date;
  interactionSessionId: string | null;
  deviceId: string | null;
  frameIdx: number | null;
  bytes: number;
};

function createMockDb() {
  const rows: WakePhotoRow[] = [];

  const db = {
    rows,
    insert: (_table: unknown) => ({
      values: (vals: WakePhotoRow) => ({
        onConflictDoNothing: () => {
          if (rows.some((r) => r.path === vals.path)) return Promise.resolve({ rowCount: 0 });
          rows.push(vals);
          return Promise.resolve({ rowCount: 1 });
        },
      }),
    }),
    select: () => ({
      from: (_table: unknown) => ({
        orderBy: (_o: unknown) =>
          Promise.resolve(
            [...rows].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime()),
          ),
      }),
    }),
  };

  // biome-ignore lint: test harness stands in for NodePgDatabase<typeof schema>
  return db as any;
}

function meta(overrides: Partial<WakePhotoMeta> = {}): WakePhotoMeta {
  return {
    capturedAt: Date.UTC(2026, 6, 17, 12, 0, 0),
    deviceId: "ipad13-1-3f9a2c1b",
    sessionId: "isn_abc123abc123",
    frameIdx: 0,
    ...overrides,
  };
}

describe("wake-photo-service", () => {
  let root: string;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wake-photos-test-"));
    db = createMockDb();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("saves under a flat ISO-instant path and round-trips through read", async () => {
    const ts = Date.UTC(2026, 6, 17, 12, 0, 0);
    const rel = await saveWakePhoto(db, jpeg("frame"), meta({ capturedAt: ts }), root);
    expect(rel).toBe("2026-07-17T12-00-00.000Z-0.jpg");
    const read = await readWakePhoto(rel, root);
    expect(read).not.toBeNull();
    expect([...(read?.bytes ?? [])].slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);
  });

  it("records an index row carrying the session, device and frame index", async () => {
    const ts = Date.UTC(2026, 6, 18, 12, 0, 0);
    const path = await saveWakePhoto(
      db,
      jpeg("frame"),
      meta({ capturedAt: ts, frameIdx: 1 }),
      root,
    );

    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      path,
      interactionSessionId: "isn_abc123abc123",
      deviceId: "ipad13-1-3f9a2c1b",
      frameIdx: 1,
      bytes: jpeg("frame").length,
    });
    expect(db.rows[0].capturedAt.getTime()).toBe(ts);
  });

  it("stores the bytes even when there is no session to attribute them to", async () => {
    const path = await saveWakePhoto(
      db,
      jpeg("x"),
      meta({ sessionId: null, deviceId: null }),
      root,
    );
    expect(db.rows[0].interactionSessionId).toBeNull();
    expect(await readWakePhoto(path, root)).not.toBeNull();
  });

  it("suffixes same-timestamp frames instead of overwriting", async () => {
    const ts = Date.UTC(2026, 6, 17, 12, 0, 0);
    const a = await saveWakePhoto(db, jpeg("a"), meta({ capturedAt: ts }), root);
    const b = await saveWakePhoto(db, jpeg("b"), meta({ capturedAt: ts, frameIdx: 1 }), root);
    expect(a).not.toEqual(b);
    expect(b.endsWith("-1.jpg")).toBe(true);
  });

  it("rejects non-JPEG bytes", async () => {
    await expect(
      saveWakePhoto(db, new TextEncoder().encode("plain text"), meta(), root),
    ).rejects.toThrow(/not a JPEG/);
    expect(db.rows).toHaveLength(0);
  });

  it("rejects oversize bodies", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    await expect(saveWakePhoto(db, big, meta(), root)).rejects.toThrow(/too large/);
  });

  it("backfills index rows for photos already on disk, and is idempotent", async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "2026-07-18T12-40-00.000Z-0.jpg"), jpeg("old"));

    const first = await backfillWakePhotoIndex(db, root);
    expect(first).toEqual({ scanned: 1, inserted: 1 });

    // Unattributed by construction: the filename never carried a session.
    expect(db.rows[0].interactionSessionId).toBeNull();
    expect(db.rows[0].frameIdx).toBeNull();
    expect(db.rows[0].capturedAt.getTime()).toBe(Date.UTC(2026, 6, 18, 12, 40, 0));

    const second = await backfillWakePhotoIndex(db, root);
    expect(second).toEqual({ scanned: 1, inserted: 0 });
  });

  it("lists from the index newest-first with counts and sizes", async () => {
    const day1 = Date.UTC(2026, 6, 16, 9, 0, 0);
    const day2a = Date.UTC(2026, 6, 17, 8, 0, 0);
    const day2b = Date.UTC(2026, 6, 17, 14, 30, 0);
    await saveWakePhoto(db, jpeg("one"), meta({ capturedAt: day1 }), root);
    await saveWakePhoto(db, jpeg("two"), meta({ capturedAt: day2a }), root);
    await saveWakePhoto(db, jpeg("three"), meta({ capturedAt: day2b }), root);

    const listing = await listWakePhotos(db);
    expect(listing.totalCount).toBe(3);
    expect(listing.totalBytes).toBeGreaterThan(0);
    expect(listing.days.map((d) => d.day)).toEqual(["2026-07-17", "2026-07-16"]);
    expect(listing.days[0]?.photos.map((p) => p.capturedAt)).toEqual([day2b, day2a]);
  });

  it("empty index lists empty", async () => {
    const listing = await listWakePhotos(db);
    expect(listing).toEqual({ days: [], totalCount: 0, totalBytes: 0 });
  });

  it("read rejects path traversal", async () => {
    expect(await readWakePhoto("../../etc/passwd", root)).toBeNull();
    expect(await readWakePhoto("/etc/passwd", root)).toBeNull();
  });

  it("read returns null for missing files", async () => {
    expect(await readWakePhoto("2026-01-01T00-00-00.000Z-0.jpg", root)).toBeNull();
  });
});
