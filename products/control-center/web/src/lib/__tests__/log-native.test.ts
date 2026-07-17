import { beforeEach, describe, expect, it } from "vitest";
import { getDeviceName } from "../device-name";
import type { LogFilesystem } from "../log/native";
import {
  getMirrorFileUris,
  nativeAppend,
  resetNativeForTests,
  restoreFromNative,
  setFilesystemForTests,
} from "../log/native";
import type { LogEntry } from "../log/types";

function id(seq: number, boot = 1): string {
  return `${String(boot).padStart(14, "0")}-${String(seq).padStart(8, "0")}`;
}

function entry(seq: number, over: Partial<LogEntry> = {}): LogEntry {
  return {
    id: id(seq),
    seq,
    ts: 1_700_000_000_000 + seq,
    sha: "abc1234",
    deviceName: "test-device",
    level: "info",
    source: "test",
    msg: `message ${seq}`,
    ...over,
  };
}

/** In-memory Filesystem fake: path -> content, mirroring the plugin's semantics. */
function makeFakeFs() {
  const files = new Map<string, string>();
  const fs: LogFilesystem = {
    async appendFile({ path, data }) {
      files.set(path, (files.get(path) ?? "") + data);
    },
    async readFile({ path }) {
      const data = files.get(path);
      if (data === undefined) throw new Error("File does not exist");
      return { data };
    },
    async stat({ path }) {
      const data = files.get(path);
      if (data === undefined) throw new Error("File does not exist");
      return { size: data.length };
    },
    async getUri({ path }) {
      return { uri: `file:///fake/${path}` };
    },
    async rename({ from, to }) {
      const data = files.get(from);
      if (data === undefined) throw new Error("File does not exist");
      files.set(to, data);
      files.delete(from);
    },
    async deleteFile({ path }) {
      if (!files.delete(path)) throw new Error("File does not exist");
    },
    async mkdir() {
      // directories are implicit in the fake
    },
  };
  return { fs, files };
}

const CURRENT = "cc-logs/current.jsonl";
const PREVIOUS = "cc-logs/previous.jsonl";

beforeEach(() => {
  resetNativeForTests();
});

describe("native log mirror", () => {
  it("is a silent no-op with no filesystem (browser)", async () => {
    setFilesystemForTests(null);
    await nativeAppend([entry(1)]);
    const restored = await restoreFromNative(
      async () => true,
      async () => {
        throw new Error("append must not be called off-device");
      },
    );
    expect(restored).toBe(0);
  });

  it("appends batches as JSONL to the current generation", async () => {
    const { fs, files } = makeFakeFs();
    setFilesystemForTests(fs);
    await nativeAppend([entry(1), entry(2)]);
    await nativeAppend([entry(3)]);
    const lines = (files.get(CURRENT) ?? "").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect((JSON.parse(lines[2] ?? "") as LogEntry).seq).toBe(3);
  });

  it("restores nothing when the store is not empty", async () => {
    const { fs } = makeFakeFs();
    setFilesystemForTests(fs);
    await nativeAppend([entry(1)]);
    const restored = await restoreFromNative(
      async () => false,
      async () => {
        throw new Error("append must not run when the store has rows");
      },
    );
    expect(restored).toBe(0);
  });

  it("restores previous-then-current when the store is empty", async () => {
    const { fs, files } = makeFakeFs();
    files.set(PREVIOUS, `${JSON.stringify(entry(1))}\n${JSON.stringify(entry(2))}\n`);
    files.set(CURRENT, `${JSON.stringify(entry(3))}\n`);
    setFilesystemForTests(fs);

    const seen: number[] = [];
    const restored = await restoreFromNative(
      async () => true,
      async (batch) => {
        seen.push(...batch.map((e) => e.seq));
      },
    );
    expect(restored).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("skips a torn tail line from a mid-write kill", async () => {
    const { fs, files } = makeFakeFs();
    files.set(CURRENT, `${JSON.stringify(entry(1))}\n{"id":"0000000000`);
    setFilesystemForTests(fs);

    const seen: number[] = [];
    const restored = await restoreFromNative(
      async () => true,
      async (batch) => {
        seen.push(...batch.map((e) => e.seq));
      },
    );
    expect(restored).toBe(1);
    expect(seen).toEqual([1]);
  });

  it("backfills deviceName on restored mirror lines that predate the field", async () => {
    // The mirror is this device's own history, so backfill uses its resolved name.
    const expected = getDeviceName();
    const { fs, files } = makeFakeFs();
    // A legacy line with no deviceName, and a modern line that already carries one.
    const legacy = {
      id: id(1),
      seq: 1,
      ts: 1,
      sha: "abc1234",
      level: "info",
      source: "old",
      msg: "legacy",
    };
    const modern = entry(2, { deviceName: "other-device" });
    files.set(CURRENT, `${JSON.stringify(legacy)}\n${JSON.stringify(modern)}\n`);
    setFilesystemForTests(fs);

    const seen: LogEntry[] = [];
    const restored = await restoreFromNative(
      async () => true,
      async (batch) => {
        seen.push(...batch);
      },
    );

    expect(restored).toBe(2);
    // The legacy line gains this device's name; the modern line keeps its own.
    expect(expected).not.toBe("");
    expect(seen.find((e) => e.seq === 1)?.deviceName).toBe(expected);
    expect(seen.find((e) => e.seq === 2)?.deviceName).toBe("other-device");
  });

  describe("getMirrorFileUris", () => {
    it("returns [] off-device (no filesystem)", async () => {
      setFilesystemForTests(null);
      expect(await getMirrorFileUris()).toEqual([]);
    });

    it("returns [] when nothing has been written yet", async () => {
      const { fs } = makeFakeFs();
      setFilesystemForTests(fs);
      expect(await getMirrorFileUris()).toEqual([]);
    });

    it("returns only the current URI when previous doesn't exist", async () => {
      const { fs } = makeFakeFs();
      setFilesystemForTests(fs);
      await nativeAppend([entry(1)]);
      expect(await getMirrorFileUris()).toEqual([`file:///fake/${CURRENT}`]);
    });

    it("returns [previous, current] when both generations exist", async () => {
      const { fs, files } = makeFakeFs();
      files.set(PREVIOUS, `${JSON.stringify(entry(1))}\n`);
      files.set(CURRENT, `${JSON.stringify(entry(2))}\n`);
      setFilesystemForTests(fs);
      expect(await getMirrorFileUris()).toEqual([
        `file:///fake/${PREVIOUS}`,
        `file:///fake/${CURRENT}`,
      ]);
    });
  });

  it("rotates current to previous when the generation cap trips", async () => {
    const { fs, files } = makeFakeFs();
    // Pre-seed a current file already at the cap, so the next append rotates.
    files.set(CURRENT, "x".repeat(64 * 1024 * 1024));
    files.set(PREVIOUS, "old-generation\n");
    setFilesystemForTests(fs);

    await nativeAppend([entry(9)]);
    expect(files.get(PREVIOUS)).toBe("x".repeat(64 * 1024 * 1024));
    const lines = (files.get(CURRENT) ?? "").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0] ?? "") as LogEntry).seq).toBe(9);
  });
});
