import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listWakePhotos, readWakePhoto, saveWakePhoto } from "./wake-photo-service";

// Minimal valid-enough JPEG body: SOI marker prefix + payload.
function jpeg(payload = "x"): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, ...new TextEncoder().encode(payload)]);
}

describe("wake-photo-service", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wake-photos-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("saves under the dated path and round-trips through read", async () => {
    // 2026-07-17T12:00:00Z
    const ts = Date.UTC(2026, 6, 17, 12, 0, 0);
    const rel = await saveWakePhoto(jpeg("frame"), ts, root);
    expect(rel).toMatch(/^2026[/\\]07[/\\]17[/\\]\d+-0\.jpg$/);
    const read = await readWakePhoto(rel, root);
    expect(read).not.toBeNull();
    expect([...(read?.bytes ?? [])].slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);
  });

  it("suffixes same-timestamp frames instead of overwriting", async () => {
    const ts = Date.UTC(2026, 6, 17, 12, 0, 0);
    const a = await saveWakePhoto(jpeg("a"), ts, root);
    const b = await saveWakePhoto(jpeg("b"), ts, root);
    expect(a).not.toEqual(b);
    expect(b.endsWith("-1.jpg")).toBe(true);
  });

  it("rejects non-JPEG bytes", async () => {
    await expect(
      saveWakePhoto(new TextEncoder().encode("plain text"), Date.UTC(2026, 0, 1), root),
    ).rejects.toThrow(/not a JPEG/);
  });

  it("rejects oversize bodies", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    await expect(saveWakePhoto(big, Date.UTC(2026, 0, 1), root)).rejects.toThrow(/too large/);
  });

  it("lists newest-first with counts and sizes", async () => {
    const day1 = Date.UTC(2026, 6, 16, 9, 0, 0);
    const day2a = Date.UTC(2026, 6, 17, 8, 0, 0);
    const day2b = Date.UTC(2026, 6, 17, 14, 30, 0);
    await saveWakePhoto(jpeg("one"), day1, root);
    await saveWakePhoto(jpeg("two"), day2a, root);
    await saveWakePhoto(jpeg("three"), day2b, root);

    const listing = await listWakePhotos(root);
    expect(listing.totalCount).toBe(3);
    expect(listing.totalBytes).toBeGreaterThan(0);
    expect(listing.days.map((d) => d.day)).toEqual(["2026-07-17", "2026-07-16"]);
    expect(listing.days[0]?.photos.map((p) => p.capturedAt)).toEqual([day2b, day2a]);
  });

  it("empty root lists empty", async () => {
    const listing = await listWakePhotos(join(root, "never-created"));
    expect(listing).toEqual({ days: [], totalCount: 0, totalBytes: 0 });
  });

  it("read rejects path traversal", async () => {
    expect(await readWakePhoto("../../etc/passwd", root)).toBeNull();
    expect(await readWakePhoto("/etc/passwd", root)).toBeNull();
  });

  it("read returns null for missing files", async () => {
    expect(await readWakePhoto("2026/01/01/1-0.jpg", root)).toBeNull();
  });
});
