/**
 * Tests for the media domain schema (CC-kp4k.1, CC-kp4k.10).
 * Verifies table shape, column names, constraints (primaryKey, FK onDelete:cascade,
 * uniqueIndex), and default values via Drizzle introspection.
 * No DB connection needed — all checks use static schema metadata.
 */
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { mediaItem, mediaSource } from "../db/schema";
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
    expect(cols).toContain("kind");
    expect(cols).toContain("externalId");
    expect(cols).toContain("url");
    expect(cols).toContain("title");
    expect(cols).toContain("enabled");
    expect(cols).toContain("videoPolicy");
    expect(cols).toContain("createdAt");
  });

  it("id is the primary key", () => {
    const cfg = getTableConfig(mediaSource);
    const idCol = col(cfg, "id");
    expect(idCol.primary).toBe(true);
  });

  it("required fields are notNull", () => {
    const cfg = getTableConfig(mediaSource);
    for (const name of ["id", "kind", "title", "enabled", "video_policy", "created_at"]) {
      expect(col(cfg, name).notNull).toBe(true);
    }
  });

  it("video_policy defaults to 'none'", () => {
    const cfg = getTableConfig(mediaSource);
    const c = col(cfg, "video_policy");
    expect(c.hasDefault).toBe(true);
    expect(c.default).toBe("none");
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
    expect(cols).toContain("rawTitle");
    expect(cols).toContain("cleanTitle");
    expect(cols).toContain("artist");
    expect(cols).toContain("event");
    expect(cols).toContain("category");
    expect(cols).toContain("status");
    expect(cols).toContain("audioPath");
    expect(cols).toContain("videoPath");
    expect(cols).toContain("thumbPath");
    expect(cols).toContain("audioBytes");
    expect(cols).toContain("videoBytes");
    expect(cols).toContain("durationSec");
    expect(cols).toContain("error");
    expect(cols).toContain("retries");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });

  it("id is the primary key", () => {
    const cfg = getTableConfig(mediaItem);
    const idCol = col(cfg, "id");
    expect(idCol.primary).toBe(true);
  });

  it("yt_video_id has a unique index (A1 idempotency — re-poll must not create duplicates)", () => {
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

  it("retries defaults to 0", () => {
    const cfg = getTableConfig(mediaItem);
    const c = col(cfg, "retries");
    expect(c.hasDefault).toBe(true);
    expect(c.default).toBe(0);
  });

  it("required fields are notNull", () => {
    const cfg = getTableConfig(mediaItem);
    for (const name of ["id", "source_id", "yt_video_id", "raw_title", "status", "retries"]) {
      expect(col(cfg, name).notNull).toBe(true);
    }
  });
});

describe("env schema media keys (CC-kp4k.1)", () => {
  it("accepts OPENROUTER_API_KEY", () => {
    const result = envSchema.parse({ OPENROUTER_API_KEY: "sk-or-test-key" });
    expect(result.OPENROUTER_API_KEY).toBe("sk-or-test-key");
  });

  it("defaults OPENROUTER_API_KEY to empty string", () => {
    const result = envSchema.parse({});
    expect(result.OPENROUTER_API_KEY).toBe("");
  });

  it("accepts MEDIA_STORAGE_DIR", () => {
    const result = envSchema.parse({ MEDIA_STORAGE_DIR: "/mnt/media" });
    expect(result.MEDIA_STORAGE_DIR).toBe("/mnt/media");
  });

  it("defaults MEDIA_STORAGE_DIR to /mnt/media", () => {
    const result = envSchema.parse({});
    expect(result.MEDIA_STORAGE_DIR).toBe("/mnt/media");
  });
});

describe("media barrel exports (CC-kp4k.1)", () => {
  it("exposes mediaSource from the media barrel", async () => {
    const barrel = await import("../media");
    expect(barrel.mediaSource).toBeDefined();
  });

  it("exposes mediaItem from the media barrel", async () => {
    const barrel = await import("../media");
    expect(barrel.mediaItem).toBeDefined();
  });
});
