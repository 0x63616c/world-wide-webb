import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  instantToken,
  nextFreeName,
  parseLegacyPhotoFileName,
  parsePhotoFileName,
  photoFileName,
} from "./index";

describe("media-path", () => {
  it("renders the instant as ISO 8601 with dashes for colons, always UTC", () => {
    expect(instantToken(Date.UTC(2026, 5, 1, 14, 28, 6, 155))).toBe("2026-06-01T14-28-06.155Z");
  });

  it("keeps milliseconds and Z so every name is fixed-width and sorts chronologically", () => {
    const names = [
      photoFileName(Date.UTC(2026, 5, 1, 14, 28, 6, 155), 0, "jpg"),
      photoFileName(Date.UTC(2026, 5, 1, 14, 28, 6, 7), 0, "jpg"),
      photoFileName(Date.UTC(2026, 5, 1, 9, 0, 0, 0), 0, "jpg"),
    ];
    expect(new Set(names.map((n) => n.length)).size).toBe(1);
    expect([...names].sort()).toEqual([
      "2026-06-01T09-00-00.000Z-0.jpg",
      "2026-06-01T14-28-06.007Z-0.jpg",
      "2026-06-01T14-28-06.155Z-0.jpg",
    ]);
  });

  it("never emits a colon (illegal on SMB/exFAT, rendered as / by Finder)", () => {
    expect(photoFileName(Date.UTC(2026, 5, 1, 14, 28, 6, 155), 3, "gif")).not.toContain(":");
  });

  it("round-trips a name back to its exact instant", () => {
    const ms = Date.UTC(2026, 5, 1, 14, 28, 6, 155);
    expect(parsePhotoFileName(photoFileName(ms, 2, "gif"))).toEqual({
      capturedAt: ms,
      n: 2,
      ext: "gif",
    });
  });

  // The predecessor parsed `Number(f.split("-")[0])`, which on a new-format name
  // yields 2026 , finite, so it passed an isFinite guard and would have indexed
  // the photo at 1970-01-01T00:00:02.026Z. That is 56 years past the 90-day wake
  // retention cutoff, so the next nightly purge would have unlinked the file.
  it("does not mis-parse a new-format name into 1970", () => {
    const parsed = parsePhotoFileName("2026-06-01T14-28-06.155Z-0.jpg");
    expect(parsed?.capturedAt).toBe(Date.UTC(2026, 5, 1, 14, 28, 6, 155));
    expect(new Date(parsed?.capturedAt ?? 0).getUTCFullYear()).toBe(2026);
  });

  it("rejects names that are not in the scheme rather than half-matching them", () => {
    for (const bad of [
      "2026/07/18/1752849600000-0.jpg", // legacy path
      "1752849600000-0.jpg", // legacy name
      "2026-06-01T14-28-06Z-0.jpg", // no milliseconds
      "2026-06-01T14:28:06.155Z-0.jpg", // colons
      "2026-06-01T14-28-06.155Z.jpg", // no counter
      "notes.txt",
      ".DS_Store",
    ]) {
      expect(parsePhotoFileName(bad), bad).toBeNull();
    }
  });

  it("rejects an implausibly old instant instead of handing it to the purge", () => {
    expect(parsePhotoFileName("1970-01-01T00-00-02.026Z-0.jpg")).toBeNull();
    expect(parsePhotoFileName("2019-12-31T23-59-59.999Z-0.jpg")).toBeNull();
  });

  it("parses the legacy epoch scheme the migration reads", () => {
    expect(parseLegacyPhotoFileName("1784516886155-0.jpg")).toEqual({
      capturedAt: 1784516886155,
      n: 0,
      ext: "jpg",
    });
    expect(parseLegacyPhotoFileName("2026-06-01T14-28-06.155Z-0.jpg")).toBeNull();
  });

  it("hands out the first free counter, stepping over taken ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "media-path-"));
    const ms = Date.UTC(2026, 5, 1, 14, 28, 6, 155);

    expect(await nextFreeName(root, ms, "jpg")).toBe("2026-06-01T14-28-06.155Z-0.jpg");

    await writeFile(join(root, "2026-06-01T14-28-06.155Z-0.jpg"), "a");
    expect(await nextFreeName(root, ms, "jpg")).toBe("2026-06-01T14-28-06.155Z-1.jpg");

    await writeFile(join(root, "2026-06-01T14-28-06.155Z-1.jpg"), "b");
    expect(await nextFreeName(root, ms, "jpg")).toBe("2026-06-01T14-28-06.155Z-2.jpg");

    // A different extension is a different name, so it does not collide.
    expect(await nextFreeName(root, ms, "gif")).toBe("2026-06-01T14-28-06.155Z-0.gif");
  });
});
