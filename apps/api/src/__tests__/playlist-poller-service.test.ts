/**
 * Unit tests for the playlist-poller service (www-kp4k.3).
 * Tests: idempotency (re-poll of unchanged playlist = zero new rows),
 * new IDs → media_item insert + job enqueue, broken source continues others.
 *
 * DB and enqueueJob are fully mocked — no real Postgres or yt-dlp calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPlaylistPollerCycle } from "../services/playlist-poller-service";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  sources: [] as Array<{
    id: string;
    kind: string;
    url: string | null;
    externalId: string | null;
    enabled: boolean;
    videoPolicy: string;
    title: string;
    createdAt: Date;
  }>,
  existingVideoIds: [] as string[],
  inserted: [] as Array<Record<string, unknown>>,
  enqueuedJobs: [] as Array<{ type: string; payload: unknown }>,
}));

vi.mock("../db/index", () => {
  const db = {
    select: () => ({
      from: (table: unknown) => {
        // mediaItem query returns existingVideoIds
        const isMediaItem =
          typeof table === "object" &&
          table !== null &&
          "ytVideoId" in (table as Record<string, unknown>);
        if (isMediaItem) {
          return {
            where: () =>
              Promise.resolve(mockState.existingVideoIds.map((id) => ({ ytVideoId: id }))),
          };
        }
        // mediaSource query returns sources
        return {
          where: () => Promise.resolve(mockState.sources),
        };
      },
    }),
    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        const inserted = { ...row };
        return {
          onConflictDoNothing: () => ({
            returning: (_fields: unknown) => {
              // Only "insert" if not conflicting (simulate unique index).
              const ytId = inserted.ytVideoId as string;
              if (mockState.existingVideoIds.includes(ytId)) {
                return Promise.resolve([]);
              }
              mockState.inserted.push(inserted);
              mockState.existingVideoIds.push(ytId);
              return Promise.resolve([{ id: `mi_${ytId}` }]);
            },
          }),
        };
      },
    }),
  };
  return { db };
});

vi.mock("../jobs/queue", () => ({
  enqueueJob: async (type: string, payload: unknown) => {
    mockState.enqueuedJobs.push({ type, payload });
    return mockState.enqueuedJobs.length;
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSource(id: string, url: string, videoPolicy = "none"): (typeof mockState.sources)[0] {
  return {
    id,
    kind: "playlist",
    url,
    externalId: null,
    enabled: true,
    videoPolicy,
    title: "Test Playlist",
    createdAt: new Date(),
  };
}

// Fake yt-dlp list function — returns the given IDs synchronously.
function fakeLister(ids: string[]) {
  return async (_url: string) => ids;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockState.sources = [];
  mockState.existingVideoIds = [];
  mockState.inserted = [];
  mockState.enqueuedJobs = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runPlaylistPollerCycle — idempotency", () => {
  it("creates zero new rows when all IDs are already in media_item", async () => {
    mockState.sources = [makeSource("src_1", "https://youtube.com/playlist?list=PL1")];
    mockState.existingVideoIds = ["vid1", "vid2", "vid3"];

    await runPlaylistPollerCycle(fakeLister(["vid1", "vid2", "vid3"]));

    expect(mockState.inserted).toHaveLength(0);
    expect(mockState.enqueuedJobs).toHaveLength(0);
  });

  it("a second poll with unchanged playlist produces zero new rows", async () => {
    mockState.sources = [makeSource("src_1", "https://youtube.com/playlist?list=PL1")];
    mockState.existingVideoIds = [];

    // First poll: discovers 2 new IDs.
    await runPlaylistPollerCycle(fakeLister(["vid1", "vid2"]));
    expect(mockState.inserted).toHaveLength(2);

    const insertedAfterFirst = mockState.inserted.length;
    const enqueuedAfterFirst = mockState.enqueuedJobs.length;

    // Second poll: same IDs, nothing new.
    await runPlaylistPollerCycle(fakeLister(["vid1", "vid2"]));
    expect(mockState.inserted).toHaveLength(insertedAfterFirst);
    expect(mockState.enqueuedJobs).toHaveLength(enqueuedAfterFirst);
  });
});

describe("runPlaylistPollerCycle — new IDs", () => {
  it("inserts media_item rows and enqueues youtube_ingest jobs for new IDs", async () => {
    mockState.sources = [makeSource("src_1", "https://youtube.com/playlist?list=PL1")];
    mockState.existingVideoIds = [];

    await runPlaylistPollerCycle(fakeLister(["vid1", "vid2"]));

    expect(mockState.inserted).toHaveLength(2);
    expect(mockState.enqueuedJobs).toHaveLength(2);
    expect(mockState.enqueuedJobs[0]).toMatchObject({ type: "youtube_ingest" });
    const payload = mockState.enqueuedJobs[0].payload as { videoId: string };
    expect(["vid1", "vid2"]).toContain(payload.videoId);
  });

  it("only enqueues for truly new IDs when some already exist", async () => {
    mockState.sources = [makeSource("src_1", "https://youtube.com/playlist?list=PL1")];
    mockState.existingVideoIds = ["vid1"]; // vid1 already known

    await runPlaylistPollerCycle(fakeLister(["vid1", "vid2", "vid3"]));

    // Only vid2 and vid3 are new.
    expect(mockState.inserted).toHaveLength(2);
    expect(mockState.enqueuedJobs).toHaveLength(2);
  });
});

describe("runPlaylistPollerCycle — error handling", () => {
  it("continues processing other sources when yt-dlp fails for one", async () => {
    mockState.sources = [
      makeSource("src_broken", "https://youtube.com/playlist?list=PL_broken"),
      makeSource("src_ok", "https://youtube.com/playlist?list=PL_ok"),
    ];
    mockState.existingVideoIds = [];

    // Lister that throws for the first URL, succeeds for the second.
    const lister = async (url: string) => {
      if (url.includes("broken")) throw new Error("yt-dlp subprocess failed");
      return ["vidok1"];
    };

    await runPlaylistPollerCycle(lister);

    // Should still have processed the second source.
    expect(mockState.inserted).toHaveLength(1);
    expect(mockState.enqueuedJobs).toHaveLength(1);
  });

  it("skips sources with no URL and no externalId", async () => {
    mockState.sources = [{ ...makeSource("src_1", ""), url: null, externalId: null }];
    await runPlaylistPollerCycle(fakeLister(["vid1"]));
    expect(mockState.inserted).toHaveLength(0);
  });
});
