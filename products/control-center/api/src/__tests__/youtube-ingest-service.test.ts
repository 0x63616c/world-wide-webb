/**
 * Unit tests for ytdlpDownload and the youtube_ingest handler (www-kp4k.4 + www-kp4k.5).
 * - ytdlpDownload: execFile mocked, one video-only download call asserted.
 * - Handler exports verified.
 *
 * DB fully mocked , no real Postgres or yt-dlp subprocess.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ytdlpDownload } from "../services/youtube-ingest-service";

// ── execFile mock ─────────────────────────────────────────────────────────────
// The service builds its promisified downloader from node:child_process's
// execFile at module load, so we mock the module and route every call through a
// swappable impl. promisify appends a Node-style callback as the final argument;
// resolving it with { stdout, stderr } is what execFileAsync destructures.

const execFileState = vi.hoisted(() => ({
  impl: null as
    | null
    | ((
        file: string,
        args: string[],
        options: Record<string, unknown>,
        cb: (err: unknown, res: { stdout: string; stderr: string }) => void,
      ) => void),
}));

vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    options: Record<string, unknown>,
    cb: (err: unknown, res: { stdout: string; stderr: string }) => void,
  ) => {
    if (!execFileState.impl) throw new Error("execFile impl not set for this test");
    execFileState.impl(file, args, options, cb);
  },
}));

/** Install an execFile mock that records the argv array of every call. */
function captureExecFile(stdoutLines: string[]): string[][] {
  const calls: string[][] = [];
  execFileState.impl = (_file, args, _options, cb) => {
    calls.push(args);
    cb(null, { stdout: `${stdoutLines.join("\n")}\n`, stderr: "" });
  };
  return calls;
}

/** Install an execFile mock that records the options object of every call. */
function mockExecFileOptions(sink: Array<Record<string, unknown>>, stdoutLines: string[]): void {
  execFileState.impl = (_file, _args, options, cb) => {
    sink.push(options);
    cb(null, { stdout: `${stdoutLines.join("\n")}\n`, stderr: "" });
  };
}

// ── fs mock ──────────────────────────────────────────────────────────────────
// ytdlpDownload now verifies the path yt-dlp reports actually exists on disk
// before trusting it. None of the fake paths in this file are real, so we mock
// existsSync: true for the reported video path (the happy-path default), false
// for thumbnail extensions (no thumbnail was written in these fixtures).

const fsState = vi.hoisted(() => ({
  existsImpl: (path: string) => !/\.(jpg|jpeg|png|webp)$/.test(path),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (path: string) => fsState.existsImpl(path),
  };
});

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
    MEDIA_STORAGE_DIR: "/tmp/test-media",
    NODE_ENV: "test",
  },
}));

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  dbState.items = [];
  dbState.updates = [];
  execFileState.impl = null;
  fsState.existsImpl = (path: string) => !/\.(jpg|jpeg|png|webp)$/.test(path);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── ytdlpDownload tests ─────────────────────────────────────────────────────────

/** One printed line as yt-dlp emits it: path, title, uploader, duration. */
const PRINTED = "/media/youtube/yt-abc123.webm\tAxwell - Live at Ultra\tAxwell\t7245";

describe("ytdlpDownload", () => {
  it("makes exactly one yt-dlp call", async () => {
    const calls = captureExecFile([PRINTED]);
    await ytdlpDownload("abc123", "/media", new AbortController().signal);
    // One call only: metadata rides the download's --print rather than a second
    // --dump-json round-trip.
    expect(calls).toHaveLength(1);
  });

  it("requests the best stream up to 4K and never re-encodes", async () => {
    const calls = captureExecFile([PRINTED]);
    await ytdlpDownload("abc123", "/media", new AbortController().signal);
    expect(calls[0]).toContain("bv*[height<=2160]+ba/b[height<=2160]");
  });

  it("prefers AV1 only at equal resolution", async () => {
    const calls = captureExecFile([PRINTED]);
    await ytdlpDownload("abc123", "/media", new AbortController().signal);
    const sort = calls[0][calls[0].indexOf("-S") + 1];
    expect(sort).toBe("res,vcodec:av01");
  });

  it("downloads fragments concurrently", async () => {
    const calls = captureExecFile([PRINTED]);
    await ytdlpDownload("abc123", "/media", new AbortController().signal);
    expect(calls[0]).toContain("-N");
    expect(calls[0]).toContain("4");
  });

  it("names files by video id alone, under a yt- prefix", async () => {
    const calls = captureExecFile([PRINTED]);
    await ytdlpDownload("abc123", "/media", new AbortController().signal);
    const output = calls[0][calls[0].indexOf("--output") + 1];
    expect(output).toBe("/media/youtube/yt-%(id)s.%(ext)s");
  });

  it("returns the path yt-dlp reports rather than guessing it", async () => {
    captureExecFile([PRINTED]);
    const out = await ytdlpDownload("abc123", "/media", new AbortController().signal);
    expect(out.videoPath).toBe("/media/youtube/yt-abc123.webm");
  });

  it("parses title, uploader and duration from the printed line", async () => {
    captureExecFile([PRINTED]);
    const out = await ytdlpDownload("abc123", "/media", new AbortController().signal);
    expect(out.title).toBe("Axwell - Live at Ultra");
    expect(out.uploader).toBe("Axwell");
    expect(out.durationSec).toBe(7245);
  });

  it("treats yt-dlp's NA placeholder as missing metadata", async () => {
    captureExecFile(["/media/youtube/yt-abc123.webm\tNA\tNA\tNA"]);
    const out = await ytdlpDownload("abc123", "/media", new AbortController().signal);
    expect(out.title).toBeNull();
    expect(out.uploader).toBeNull();
    expect(out.durationSec).toBeNull();
  });

  it("forwards the abort signal so a timeout kills the subprocess", async () => {
    const calls: Array<Record<string, unknown>> = [];
    mockExecFileOptions(calls, [PRINTED]);
    const ac = new AbortController();
    await ytdlpDownload("abc123", "/media", ac.signal);
    expect(calls[0]?.signal).toBe(ac.signal);
  });

  it("never downloads audio separately", async () => {
    const calls = captureExecFile([PRINTED]);
    await ytdlpDownload("abc123", "/media", new AbortController().signal);
    expect(calls[0]).not.toContain("-x");
    expect(calls[0]).not.toContain("bestaudio");
  });

  it("rejects when yt-dlp prints nothing", async () => {
    captureExecFile([]);
    await expect(ytdlpDownload("abc123", "/media", new AbortController().signal)).rejects.toThrow(
      /no output path/,
    );
  });

  it("rejects when yt-dlp reports a path that does not exist on disk", async () => {
    fsState.existsImpl = () => false;
    captureExecFile([PRINTED]);
    await expect(ytdlpDownload("abc123", "/media", new AbortController().signal)).rejects.toThrow(
      /does not exist/,
    );
  });
});

// ── Export surface ────────────────────────────────────────────────────────────

describe("youtube-ingest-service exports", () => {
  it("ytdlpDownload is exported", async () => {
    const mod = await import("../services/youtube-ingest-service");
    expect(typeof mod.ytdlpDownload).toBe("function");
  });

  it("runYoutubeIngest is exported", async () => {
    const mod = await import("../services/youtube-ingest-service");
    expect(typeof mod.runYoutubeIngest).toBe("function");
  });
});
