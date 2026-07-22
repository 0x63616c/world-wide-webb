/**
 * Unit tests for the disk-space guard.
 * Tests: returns false below threshold, true above, true when dir missing.
 * Also verifies that the structured logger is called with the expected fields
 * so the observability contract is machine-checked.
 */
import { describe, expect, it, vi } from "vitest";
import { hasSufficientDisk } from "./disk-guard";

vi.mock("node:fs", () => ({
  statfsSync: (path: string) => {
    if (path === "/full") {
      // Simulate 5 GB free (below the 50 GB threshold).
      return { bavail: 5 * 1024 * 1024, bsize: 1024 };
    }
    if (path === "/empty") {
      throw new Error("ENOENT");
    }
    // Default: 100 GB free (above the 50 GB threshold).
    return { bavail: 100 * 1024 * 1024, bsize: 1024 };
  },
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
  getLogger: () => mockLog,
}));

describe("hasSufficientDisk", () => {
  const THRESHOLD = 50 * 1024 * 1024 * 1024; // 50 GB

  it("returns true when free bytes exceed threshold", () => {
    // statfsSync("/ok") returns bavail=100*1024*1024, bsize=1024 → 100 GB free.
    expect(hasSufficientDisk("/ok", THRESHOLD)).toBe(true);
  });

  it("returns false when free bytes are below threshold", () => {
    // statfsSync("/full") returns bavail=5*1024*1024, bsize=1024 → 5 GB free.
    expect(hasSufficientDisk("/full", THRESHOLD)).toBe(false);
  });

  it("defaults to a 50 GB floor when no threshold is passed", () => {
    // 100 GB free clears the default floor; 5 GB free does not.
    expect(hasSufficientDisk("/ok")).toBe(true);
    expect(hasSufficientDisk("/full")).toBe(false);
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
