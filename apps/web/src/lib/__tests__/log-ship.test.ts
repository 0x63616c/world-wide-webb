import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushNow, log, onFlushed } from "../log/logger";
import { resetShipForTests, type ShipDeps, shipOnce, startShipping } from "../log/ship";
import type { LogQuery } from "../log/store";
import * as store from "../log/store";
import type { LogEntry } from "../log/types";

/** Same fixed-width, sortable id shape the logger emits: `${bootMs}-${seq}`. */
function id(seq: number, boot = 1): string {
  return `${String(boot).padStart(14, "0")}-${String(seq).padStart(8, "0")}`;
}

function entry(seq: number, over: Partial<LogEntry> = {}): LogEntry {
  return {
    id: id(seq),
    seq,
    ts: 1_700_000_000_000 + seq,
    sha: "abc1234",
    build: "web",
    deviceName: "test-device",
    level: "info",
    source: "test",
    msg: `message ${seq}`,
    ...over,
  };
}

/** In-memory store fake mirroring store.query's `after` semantics (ascending). */
function makeFakeStore(seed: LogEntry[] = []) {
  const rows = [...seed];
  return {
    push(...more: LogEntry[]) {
      rows.push(...more);
    },
    query: vi.fn(async (q: LogQuery): Promise<LogEntry[]> => {
      const after = q.after ?? "";
      const limit = q.limit ?? 200;
      return rows
        .filter((e) => e.id > after)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, limit);
    }),
  };
}

/** In-memory cursor store. */
function makeCursorStore() {
  const map = new Map<string, string>();
  return {
    map,
    read: (deviceId: string) => map.get(deviceId),
    write: (deviceId: string, cursorId: string) => {
      map.set(deviceId, cursorId);
    },
  };
}

const DEVICE = "web-deadbeef";

/** Wire up deps around a fake store, cursor store, and a controllable transport. */
function makeDeps(seed: LogEntry[], transport: ShipDeps["transport"]) {
  const fakeStore = makeFakeStore(seed);
  const cursor = makeCursorStore();
  const deps: ShipDeps = {
    getDeviceId: () => DEVICE,
    query: fakeStore.query,
    transport,
    readCursor: cursor.read,
    writeCursor: cursor.write,
  };
  return { deps, fakeStore, cursor };
}

beforeEach(() => {
  resetShipForTests();
});

describe("log shipper", () => {
  it("ships from the start and advances the cursor to the last entry", async () => {
    const shipped: LogEntry[][] = [];
    const { deps, cursor } = makeDeps([entry(1), entry(2), entry(3)], async (_d, batch) => {
      shipped.push(batch);
    });

    await shipOnce(deps);

    expect(shipped).toHaveLength(1);
    expect(shipped[0]?.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(cursor.map.get(DEVICE)).toBe(id(3));
  });

  it("ships only entries after the persisted cursor on the next run", async () => {
    const shipped: LogEntry[][] = [];
    const { deps, fakeStore, cursor } = makeDeps([entry(1), entry(2)], async (_d, batch) => {
      shipped.push(batch);
    });

    await shipOnce(deps);
    expect(cursor.map.get(DEVICE)).toBe(id(2));

    fakeStore.push(entry(3), entry(4));
    await shipOnce(deps);

    expect(shipped[1]?.map((e) => e.seq)).toEqual([3, 4]);
    expect(cursor.map.get(DEVICE)).toBe(id(4));
  });

  it("does nothing (no transport call, no cursor write) when there is nothing new", async () => {
    const transport = vi.fn(async () => {});
    const { deps, cursor } = makeDeps([], transport);

    await shipOnce(deps);

    expect(transport).not.toHaveBeenCalled();
    expect(cursor.map.has(DEVICE)).toBe(false);
  });

  it("halts on a transport failure without advancing the cursor, then resumes next tick", async () => {
    let fail = true;
    const shipped: LogEntry[][] = [];
    const { deps, cursor } = makeDeps([entry(1), entry(2), entry(3)], async (_d, batch) => {
      if (fail) throw new Error("offline");
      shipped.push(batch);
    });

    // First run fails: no throw escapes, and the cursor is untouched.
    await expect(shipOnce(deps)).resolves.toBeUndefined();
    expect(shipped).toHaveLength(0);
    expect(cursor.map.has(DEVICE)).toBe(false);

    // Transport recovers: the next run re-ships from scratch and advances.
    fail = false;
    await shipOnce(deps);
    expect(shipped[0]?.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(cursor.map.get(DEVICE)).toBe(id(3));
  });

  it("keeps the progress of batches shipped before a mid-run failure", async () => {
    // Two full pages then a third that fails: the cursor must sit at the end of
    // the first page (the last batch that actually landed), not back at the start.
    const seed = Array.from({ length: 1001 }, (_, i) => entry(i + 1));
    let calls = 0;
    const { deps, cursor } = makeDeps(seed, async () => {
      calls++;
      if (calls === 2) throw new Error("offline mid-run");
    });

    await shipOnce(deps);

    expect(calls).toBe(2);
    // Batch 1 (seq 1..500) landed and advanced the cursor; batch 2 threw.
    expect(cursor.map.get(DEVICE)).toBe(id(500));
  });

  it("caps a long backlog at 10 batches per run and drains the rest next run", async () => {
    const seed = Array.from({ length: 5001 }, (_, i) => entry(i + 1));
    const transport = vi.fn(async () => {});
    const { deps, cursor } = makeDeps(seed, transport);

    await shipOnce(deps);
    expect(transport).toHaveBeenCalledTimes(10); // 10 * 500 = 5000
    expect(cursor.map.get(DEVICE)).toBe(id(5000));

    await shipOnce(deps);
    expect(transport).toHaveBeenCalledTimes(11); // final partial batch of 1
    expect(cursor.map.get(DEVICE)).toBe(id(5001));
  });

  it("re-ships from scratch without error after cursor loss (idempotent resend)", async () => {
    const shipped: LogEntry[][] = [];
    const { deps, cursor } = makeDeps([entry(1), entry(2), entry(3)], async (_d, batch) => {
      shipped.push(batch);
    });

    await shipOnce(deps);
    expect(cursor.map.get(DEVICE)).toBe(id(3));

    // Storage eviction drops the cursor; the next run re-sends everything and the
    // backend dedups it. Here we just assert it re-sends cleanly.
    cursor.map.delete(DEVICE);
    await expect(shipOnce(deps)).resolves.toBeUndefined();
    expect(shipped[1]?.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(cursor.map.get(DEVICE)).toBe(id(3));
  });

  it("never rejects when the store read itself fails", async () => {
    const deps: ShipDeps = {
      getDeviceId: () => DEVICE,
      query: async () => {
        throw new Error("indexeddb blew up");
      },
      transport: async () => {},
      readCursor: () => undefined,
      writeCursor: () => {},
    };
    await expect(shipOnce(deps)).resolves.toBeUndefined();
  });

  it("ignores a re-entrant call while a run is already in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const transport = vi.fn(async () => {
      await gate;
    });
    const { deps } = makeDeps([entry(1)], transport);

    const first = shipOnce(deps);
    // Second call while the first is blocked in transport: skipped, not queued.
    await shipOnce(deps);
    expect(transport).toHaveBeenCalledTimes(1);

    release();
    await first;
  });
});

describe("startShipping (flush-hook wiring)", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    store.resetForTests();
    resetShipForTests();
  });

  it("returns an unsubscribe that detaches the post-flush hook", () => {
    const stop = startShipping();
    expect(typeof stop).toBe("function");
    stop();
  });

  it("a throwing post-flush hook can never break flushing", async () => {
    // The shipper rides onFlushed; flush() guards every hook. Prove a hook that
    // throws outright does not fail the flush (logging must survive shipping bugs).
    const stop = onFlushed(() => {
      throw new Error("hook exploded");
    });
    try {
      log.info("line that triggers a flush");
      await expect(flushNow()).resolves.toBeUndefined();
    } finally {
      stop();
    }
  });
});
