import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import * as store from "../log/store";
import type { LogEntry, LogLevel } from "../log/types";

/** Same fixed-width, sortable shape the logger emits: `${bootMs}-${seq}`. */
function id(seq: number, boot = 1): string {
  return `${String(boot).padStart(14, "0")}-${String(seq).padStart(8, "0")}`;
}

function entry(seq: number, over: Partial<LogEntry> = {}): LogEntry {
  return {
    id: id(seq),
    seq,
    ts: 1_700_000_000_000 + seq,
    level: "info",
    source: "test",
    msg: `message ${seq}`,
    ...over,
  };
}

beforeEach(() => {
  // Fresh database per test; store.ts caches the open handle, so drop that too.
  globalThis.indexedDB = new IDBFactory();
  store.resetForTests();
});

describe("log store", () => {
  it("appends and reads back newest-first", async () => {
    await store.append([entry(1), entry(2), entry(3)]);
    const rows = await store.query();
    expect(rows.map((r) => r.seq)).toEqual([3, 2, 1]);
    expect(await store.count()).toBe(3);
  });

  it("pages backwards with `before`", async () => {
    await store.append([entry(1), entry(2), entry(3), entry(4)]);
    const page = await store.query({ before: id(3) });
    expect(page.map((r) => r.seq)).toEqual([2, 1]);
  });

  it("filters by an arbitrary SET of levels, not a threshold", async () => {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    await store.append(levels.map((level, i) => entry(i, { level })));

    expect((await store.query({ levels: ["warn", "error"] })).map((r) => r.level).sort()).toEqual([
      "error",
      "warn",
    ]);

    // The point of a set over a "minimum level": on a polling dashboard the debug
    // firehose is what you want off while still seeing info. A threshold cannot
    // express that.
    expect(
      (await store.query({ levels: ["info", "warn", "error"] })).map((r) => r.level).sort(),
    ).toEqual(["error", "info", "warn"]);
  });

  it("filters by source", async () => {
    await store.append([entry(1, { source: "trpc" }), entry(2, { source: "tile:weather" })]);
    const rows = await store.query({ source: "trpc" });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("trpc");
  });

  it("searches message, source and serialized data", async () => {
    await store.append([
      entry(1, { msg: "connection lost" }),
      entry(2, { msg: "all good", data: { httpStatus: 502 } }),
      entry(3, { msg: "unrelated" }),
    ]);
    expect((await store.query({ search: "connection" })).map((r) => r.seq)).toEqual([1]);
    expect((await store.query({ search: "502" })).map((r) => r.seq)).toEqual([2]);
  });

  it("honours the limit", async () => {
    await store.append(Array.from({ length: 20 }, (_, i) => entry(i)));
    expect(await store.query({ limit: 5 })).toHaveLength(5);
  });

  it("clears", async () => {
    await store.append([entry(1)]);
    await store.clear();
    expect(await store.count()).toBe(0);
  });

  it("evicts oldest-first when the byte cap is exceeded", async () => {
    // One entry whose payload alone blows the 50MB cap: proves eviction is driven
    // by bytes, not just count. A count-only policy would keep all of these and
    // fill the disk.
    const fat = "x".repeat(400_000);
    const entries = Array.from({ length: 80 }, (_, i) => entry(i, { data: { blob: fat } }));
    await store.append(entries);

    const remaining = await store.count();
    expect(remaining).toBeLessThan(entries.length);
    expect(remaining).toBeGreaterThan(0);

    // Whatever survived must be the NEWEST entries , the oldest are the ones
    // you no longer care about.
    const rows = await store.query({ limit: 1 });
    expect(rows[0].seq).toBe(79);
    const all = await store.query({ limit: 1_000 });
    const seqs = all.map((r) => r.seq);
    expect(Math.min(...seqs)).toBeGreaterThan(0);
  });

  it("keeps history from previous page loads instead of overwriting it", async () => {
    // THE regression test for this feature. Entry ids embed the boot timestamp,
    // so a reload starts a fresh `seq` at 0 WITHOUT colliding with the previous
    // session's rows. Keying the store on `seq` alone (as the first cut did)
    // meant every reload silently overwrote the last session's entries row for
    // row , and the kiosk watchdog reloads the webview on failure, so the only
    // history ever destroyed would be the history of the incident.
    const firstBoot = [
      { ...entry(0, { msg: "app start" }), id: id(0, 1) },
      { ...entry(1, { msg: "climate.get failed", level: "error" as const }), id: id(1, 1) },
    ];
    await store.append(firstBoot);

    // Second page load: seq restarts at 0, boot stamp differs.
    const secondBoot = [{ ...entry(0, { msg: "app start" }), id: id(0, 2) }];
    await store.append(secondBoot);

    expect(await store.count()).toBe(3);

    const rows = await store.query();
    // Newest first, and the pre-reload error is still there to be read.
    expect(rows.map((r) => r.id)).toEqual([id(0, 2), id(1, 1), id(0, 1)]);
    expect(rows.some((r) => r.msg === "climate.get failed")).toBe(true);
  });

  it("rebuilds a v1 database that was keyed on the per-session seq", async () => {
    // A pre-fix dev build left a v1 store keyed on `seq`. Opening it at v2 must
    // drop and rebuild it: writing into the old store would silently reinstate
    // the overwrite-on-reload bug, and a migration that quietly does nothing is
    // the hardest kind to notice.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("cc-logs", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const s = db.createObjectStore("entries", { keyPath: "seq" });
        s.createIndex("ts", "ts");
        s.createIndex("level", "level");
        db.createObjectStore("meta");
      };
      req.onsuccess = () => {
        const db = req.result;
        db.transaction("entries", "readwrite")
          .objectStore("entries")
          .put({ seq: 0, ts: 1, level: "info", source: "stale", msg: "v1 row" });
        db.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    store.resetForTests();
    await store.append([entry(0, { msg: "after upgrade" })]);

    const rows = await store.query();
    // The stale v1 row is gone and the store now keys on `id`.
    expect(rows.map((r) => r.msg)).toEqual(["after upgrade"]);
    expect(rows[0].id).toBe(id(0));
  });

  it("degrades to a no-op when IndexedDB is unavailable", async () => {
    // Private mode / a locked-down webview must not take the app down: logging is
    // the diagnostic layer, not a feature.
    // @ts-expect-error deliberately removing the global
    globalThis.indexedDB = undefined;
    store.resetForTests();
    await expect(store.append([entry(1)])).resolves.toBeUndefined();
    await expect(store.query()).resolves.toEqual([]);
    await expect(store.count()).resolves.toBe(0);
  });
});
