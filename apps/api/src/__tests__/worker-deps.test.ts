/**
 * Tests for the pieces of the worker-deps barrel that stay app-level after
 * the media split (Track C, Wave 6): the durable `job` table schema and the
 * barrel export itself. mediaSource/mediaItem schema tests moved to
 * features/sound/schema.test.ts; the poller/enforcer barrel-export checks moved
 * with those services. The MEDIA_STORAGE_DIR default is now covered by the env
 * registry tests (packages/platform/test/env.test.ts).
 */
import { describe, expect, it } from "vitest";
import { job } from "../db/schema";

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
