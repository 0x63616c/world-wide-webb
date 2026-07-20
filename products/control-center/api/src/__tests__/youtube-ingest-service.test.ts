/**
 * Unit tests for enrichTitle and the youtube_ingest handler (www-kp4k.4 + www-kp4k.5).
 * - enrichTitle: fetch mocked, tests THROW on non-OK responses.
 * - Handler exports verified.
 *
 * DB fully mocked , no real Postgres or yt-dlp subprocess.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enrichTitle } from "../services/youtube-ingest-service";

// ── DB mock ───────────────────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../db/index", () => {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(dbState.items),
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          dbState.updates.push(values);
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db };
});

// ── env mock ─────────────────────────────────────────────────────────────────

vi.mock("../env", () => ({
  env: {
    OPENROUTER_API_KEY: "test-openrouter-key",
    MEDIA_STORAGE_DIR: "/tmp/test-media",
    NODE_ENV: "test",
  },
}));

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  dbState.items = [];
  dbState.updates = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── enrichTitle tests ─────────────────────────────────────────────────────────

describe("enrichTitle", () => {
  it("returns structured metadata from a mocked OpenRouter response", async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              clean_title: "Solomun Live at EDC Las Vegas 2026",
              artist: "Solomun",
              event: "EDC Las Vegas 2026",
              category: "dj-set",
            }),
          },
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await enrichTitle("Solomun Live at EDC Las Vegas 2026 | Insomniac");
    expect(result.clean_title).toBe("Solomun Live at EDC Las Vegas 2026");
    expect(result.artist).toBe("Solomun");
    expect(result.event).toBe("EDC Las Vegas 2026");
    expect(result.category).toBe("dj-set");
  });

  it("throws on non-OK OpenRouter response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    await expect(enrichTitle("some title")).rejects.toThrow("OpenRouter HTTP 401");
  });

  it("throws when OpenRouter returns no content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    );
    await expect(enrichTitle("some title")).rejects.toThrow("OpenRouter returned no content");
  });
});

// ── Export surface ────────────────────────────────────────────────────────────

describe("youtube-ingest-service exports", () => {
  it("enrichTitle is exported", async () => {
    const mod = await import("../services/youtube-ingest-service");
    expect(typeof mod.enrichTitle).toBe("function");
  });

  it("ytdlpDownload is exported", async () => {
    const mod = await import("../services/youtube-ingest-service");
    expect(typeof mod.ytdlpDownload).toBe("function");
  });

  it("runYoutubeIngest is exported", async () => {
    const mod = await import("../services/youtube-ingest-service");
    expect(typeof mod.runYoutubeIngest).toBe("function");
  });
});
