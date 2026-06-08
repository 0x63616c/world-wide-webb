/**
 * Tests for the media domain schema (CC-kp4k.1).
 * Verifies table shape, column names, constraints, and that the media barrel
 * exports exist. These are structural/unit tests — no DB connection needed.
 */
import { describe, expect, it } from "vitest";
import { mediaItem, mediaSource } from "../db/schema";
import { envSchema } from "../env";

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
