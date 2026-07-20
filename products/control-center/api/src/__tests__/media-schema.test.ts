/**
 * Tests for the media domain schema (www-kp4k.1, www-kp4k.10).
 * Verifies table shape, column names, constraints (primaryKey, FK onDelete:cascade,
 * uniqueIndex), and default values via Drizzle introspection.
 * No DB connection needed , all checks use static schema metadata.
 */
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { job, mediaItem, mediaSource } from "../db/schema";
import { envSchema } from "../env";

// Helper: find a column config by its SQL column name.
function col(table: ReturnType<typeof getTableConfig>, name: string) {
  const c = table.columns.find((c) => c.name === name);
  if (!c) throw new Error(`Column '${name}' not found in ${table.name}`);
  return c;
}

// Drizzle stores the table name on a well-known symbol; cast through unknown to read it.
const DRIZZLE_NAME = Symbol.for("drizzle:Name") as unknown as string;

describe("media_source table schema", () => {
  it("has expected column names", () => {
    const cols = Object.keys(mediaSource);
    expect(cols).toContain("id");
    expect(cols).toContain("externalId");
    expect(cols).toContain("url");
    expect(cols).toContain("title"); // human label an operator reads in psql, kept
    expect(cols).toContain("enabled");
    expect(cols).toContain("createdAt");
  });

  it("dropped enrichment/policy columns are absent", () => {
    const cols = Object.keys(mediaSource);
    for (const dropped of ["kind", "videoPolicy"]) {
      expect(cols).not.toContain(dropped);
    }
  });

  it("id is the primary key", () => {
    const cfg = getTableConfig(mediaSource);
    const idCol = col(cfg, "id");
    expect(idCol.primary).toBe(true);
  });

  it("required fields are notNull", () => {
    const cfg = getTableConfig(mediaSource);
    for (const name of ["id", "title", "enabled", "created_at"]) {
      expect(col(cfg, name).notNull).toBe(true);
    }
  });

  it("enabled defaults to true", () => {
    const cfg = getTableConfig(mediaSource);
    const c = col(cfg, "enabled");
    expect(c.hasDefault).toBe(true);
    expect(c.default).toBe(true);
  });
});

describe("media_item table schema", () => {
  it("has expected column names", () => {
    const cols = Object.keys(mediaItem);
    expect(cols).toContain("id");
    expect(cols).toContain("sourceId");
    expect(cols).toContain("ytVideoId");
    expect(cols).toContain("rawTitle"); // identity label written by the poller, kept
    expect(cols).toContain("status");
    expect(cols).toContain("videoPath");
    expect(cols).toContain("thumbPath");
    expect(cols).toContain("videoBytes");
    expect(cols).toContain("durationSec");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });

  it("dropped enrichment/audio columns are absent", () => {
    const cols = Object.keys(mediaItem);
    for (const dropped of [
      "cleanTitle",
      "artist",
      "event",
      "category",
      "audioPath",
      "audioBytes",
      "error",
      "retries",
    ]) {
      expect(cols).not.toContain(dropped);
    }
  });

  it("id is the primary key", () => {
    const cfg = getTableConfig(mediaItem);
    const idCol = col(cfg, "id");
    expect(idCol.primary).toBe(true);
  });

  it("yt_video_id has a unique index (A1 idempotency , re-poll must not create duplicates)", () => {
    const cfg = getTableConfig(mediaItem);
    const uniqueIndexes = cfg.indexes.filter((idx) => idx.config?.unique === true);
    const names = uniqueIndexes.map((idx) => idx.config?.name);
    expect(names).toContain("media_item_yt_video_id_idx");
  });

  it("yt_video_id unique index covers only yt_video_id", () => {
    const cfg = getTableConfig(mediaItem);
    const idx = cfg.indexes.find((i) => i.config?.name === "media_item_yt_video_id_idx");
    expect(idx).toBeDefined();
    // IndexedColumn objects carry .name; SQL fragments are not expected in this index.
    const cols = idx?.config?.columns?.map((c) =>
      typeof c === "string" ? c : (c as { name: string }).name,
    );
    expect(cols).toEqual(["yt_video_id"]);
  });

  it("source_id FK references media_source.id with onDelete:cascade", () => {
    const cfg = getTableConfig(mediaItem);
    const fk = cfg.foreignKeys.find((fk) => {
      const ref = fk.reference();
      return ref.columns.some((c) => c.name === "source_id");
    });
    expect(fk).toBeDefined();
    // Guard clause satisfies the TypeScript narrowing requirement without a
    // non-null assertion: if fk is undefined the test already failed on the
    // toBeDefined() above, so this branch is unreachable in practice.
    if (!fk) throw new Error("fk unexpectedly undefined after toBeDefined()");
    const ref = fk.reference();
    // Drizzle stores table name on Symbol.for("drizzle:Name"); access via cast.
    const foreignTableName = (ref.foreignTable as unknown as Record<string, unknown>)[
      DRIZZLE_NAME
    ] as string;
    expect(foreignTableName).toBe("media_source");
    // Foreign column must be id
    expect(ref.foreignColumns.map((c) => c.name)).toContain("id");
    // onDelete must be cascade so orphan items are removed when a source is deleted
    expect(fk?.onDelete).toBe("cascade");
  });

  it("status defaults to 'pending'", () => {
    const cfg = getTableConfig(mediaItem);
    const c = col(cfg, "status");
    expect(c.hasDefault).toBe(true);
    expect(c.default).toBe("pending");
  });

  it("required fields are notNull", () => {
    const cfg = getTableConfig(mediaItem);
    for (const name of ["id", "source_id", "yt_video_id", "raw_title", "status"]) {
      expect(col(cfg, name).notNull).toBe(true);
    }
  });
});

describe("job table schema", () => {
  it("dropped result/lockedBy columns are absent", () => {
    const cols = Object.keys(job);
    for (const dropped of ["result", "lockedBy"]) {
      expect(cols).not.toContain(dropped);
    }
  });

  it("lockedAt is kept (the stale-job reaper keys off it)", () => {
    const cols = Object.keys(job);
    expect(cols).toContain("lockedAt");
  });
});

describe("env schema media keys (www-kp4k.1)", () => {
  it("accepts MEDIA_STORAGE_DIR", () => {
    const result = envSchema.parse({ MEDIA_STORAGE_DIR: "/mnt/media" });
    expect(result.MEDIA_STORAGE_DIR).toBe("/mnt/media");
  });

  it("defaults MEDIA_STORAGE_DIR to /mnt/media", () => {
    const result = envSchema.parse({});
    expect(result.MEDIA_STORAGE_DIR).toBe("/mnt/media");
  });
});

// The separate `./media` barrel is gone: media-worker merged into worker, so
// the worker barrel is the single seam and carries the media entry points.
describe("worker barrel exports the media entry points", () => {
  it("exposes runPlaylistPollerCycle from the worker barrel", async () => {
    const barrel = await import("../worker-deps");
    expect(barrel.runPlaylistPollerCycle).toBeDefined();
  });

  it("exposes runYoutubeIngest from the worker barrel", async () => {
    const barrel = await import("../worker-deps");
    expect(barrel.runYoutubeIngest).toBeDefined();
  });
});
