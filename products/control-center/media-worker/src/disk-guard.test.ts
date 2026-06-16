/**
 * Unit tests for the disk-space guard (www-kp4k.2 AC: disk guard util).
 * Tests: returns false below threshold, true above, true when dir missing.
 * Also verifies that the structured logger is called with the expected fields
 * so the observability contract is machine-checked.
 */
import { describe, expect, it, vi } from "vitest";
import { hasSufficientDisk } from "./index";

vi.mock("node:fs", () => ({
  statfsSync: (path: string) => {
    if (path === "/full") {
      // Simulate 5 GB free (below 10 GB threshold).
      return { bavail: 5 * 1024 * 1024, bsize: 1024 };
    }
    if (path === "/empty") {
      throw new Error("ENOENT");
    }
    // Default: 20 GB free.
    return { bavail: 20 * 1024 * 1024, bsize: 1024 };
  },
  // statSync is used by youtube-ingest-service but not disk guard
  statSync: () => ({ size: 1024 }),
}));

// Mock @control-center/api/media so the index.ts import doesn't try to connect to Postgres.
vi.mock("@control-center/api/media", () => ({
  env: { NODE_ENV: "test", MEDIA_STORAGE_DIR: "/tmp/test-media" },
  runMigrations: async () => undefined,
  registerYoutubeIngestHandler: () => undefined,
  claimAndRun: async () => false,
  runPlaylistPollerCycle: async () => undefined,
}));

// vi.mock factories are hoisted to the top of the file by vitest, so the
// mockLog variable must also be hoisted with vi.hoisted to be reachable inside
// the factory closure.
const { mockLog } = vi.hoisted(() => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  // child() returns a logger with the same spy shape.
  log.child.mockReturnValue(log);
  return { mockLog: log };
});

vi.mock("@www/logger", () => ({
  createLogger: () => mockLog,
}));

describe("hasSufficientDisk", () => {
  const THRESHOLD = 10 * 1024 * 1024 * 1024; // 10 GB

  it("returns true when free bytes exceed threshold", () => {
    // statfsSync("/ok") returns bavail=20*1024*1024, bsize=1024 → 20 GB free.
    expect(hasSufficientDisk("/ok", THRESHOLD)).toBe(true);
  });

  it("returns false when free bytes are below threshold", () => {
    // statfsSync("/full") returns bavail=5*1024*1024, bsize=1024 → 5 GB free.
    expect(hasSufficientDisk("/full", THRESHOLD)).toBe(false);
  });

  it("emits a structured warn with freeBytes/thresholdBytes/dir when below threshold", () => {
    mockLog.warn.mockClear();
    hasSufficientDisk("/full", THRESHOLD);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        freeBytes: expect.any(Number),
        thresholdBytes: THRESHOLD,
        dir: "/full",
      }),
      "disk below threshold, skipping claim",
    );
  });

  it("returns true when the directory does not exist (don't block startup)", () => {
    // statfsSync("/empty") throws ENOENT , guard catches and returns true.
    expect(hasSufficientDisk("/empty", THRESHOLD)).toBe(true);
  });

  it("emits a structured warn with err/dir when statfs throws", () => {
    mockLog.warn.mockClear();
    hasSufficientDisk("/empty", THRESHOLD);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), dir: "/empty" }),
      "statfs failed, assuming sufficient",
    );
  });
});
