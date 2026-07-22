import { describe, expect, it } from "vitest";
import { LogRing } from "../log/ring";
import type { LogEntry } from "../log/types";

function entry(seq: number): LogEntry {
  return {
    id: id(seq),
    seq,
    ts: seq,
    sha: "abc1234",
    deviceName: "test-device",
    level: "info",
    source: "test",
    msg: `m${seq}`,
  };
}

function id(seq: number): string {
  return `00000000000001-${String(seq).padStart(8, "0")}`;
}

describe("LogRing", () => {
  it("returns entries in insertion order before it wraps", () => {
    const ring = new LogRing(4);
    ring.push(entry(1));
    ring.push(entry(2));
    expect(ring.toArray().map((e) => e.seq)).toEqual([1, 2]);
    expect(ring.length).toBe(2);
  });

  it("evicts oldest-first once at capacity", () => {
    const ring = new LogRing(3);
    for (let i = 1; i <= 5; i += 1) ring.push(entry(i));
    // 1 and 2 fell off the end; order is still oldest-first.
    expect(ring.toArray().map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(ring.length).toBe(3);
  });

  it("stays at capacity no matter how much is pushed", () => {
    const ring = new LogRing(10);
    for (let i = 0; i < 10_000; i += 1) ring.push(entry(i));
    expect(ring.length).toBe(10);
    expect(ring.toArray().map((e) => e.seq)).toEqual([
      9990, 9991, 9992, 9993, 9994, 9995, 9996, 9997, 9998, 9999,
    ]);
  });

  it("handles the exact-capacity boundary", () => {
    const ring = new LogRing(3);
    for (let i = 1; i <= 3; i += 1) ring.push(entry(i));
    expect(ring.toArray().map((e) => e.seq)).toEqual([1, 2, 3]);
    ring.push(entry(4));
    expect(ring.toArray().map((e) => e.seq)).toEqual([2, 3, 4]);
  });

  it("clears", () => {
    const ring = new LogRing(3);
    ring.push(entry(1));
    ring.clear();
    expect(ring.length).toBe(0);
    expect(ring.toArray()).toEqual([]);
  });

  it("rejects a non-positive capacity", () => {
    expect(() => new LogRing(0)).toThrow();
  });
});
