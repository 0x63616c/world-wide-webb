/**
 * Tests for the pieces of the worker-deps barrel that stay app-level after
 * the media split (Track C, Wave 6): the durable `job` table schema, the
 * MEDIA_STORAGE_DIR env key (still read by the app-level youtube_ingest
 * handler), and the barrel export itself. mediaSource/mediaItem schema tests
 * moved to features/sound/schema.test.ts; the poller/enforcer barrel-export
 * checks moved with those services.
 */
import { describe, expect, it } from "vitest";
import { job } from "../db/schema";
import { envSchema } from "../env";

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

// The separate `./media` barrel is gone: media-worker merged into worker, and
// the playlist-poller/sonos-volume-enforcer entries moved to @features/sound
// (Wave 6). The worker barrel now carries only the app-level youtube_ingest
// entry point.
describe("worker barrel exports the app-level media entry point", () => {
  it("exposes runYoutubeIngest from the worker barrel", async () => {
    const barrel = await import("../worker-deps");
    expect(barrel.runYoutubeIngest).toBeDefined();
  });
});
