import { describe, expect, it } from "vitest";
import type { LogEntry } from "@/lib/log/types";
import { summariseWakeCapture } from "./wake-log-summary";

let seq = 0;
function entry(source: string, msg: string, level: LogEntry["level"], data?: unknown): LogEntry {
  seq += 1;
  return {
    id: `0-${seq}`,
    seq,
    ts: 1000 + seq,
    sha: "abc1234",
    deviceName: "wall-panel",
    level,
    source,
    msg,
    ...(data === undefined ? {} : { data }),
  };
}

describe("summariseWakeCapture", () => {
  it("returns null when there are no wake entries", () => {
    expect(summariseWakeCapture([entry("trpc", "fetch", "info")])).toBeNull();
  });

  it("reports a camera-open failure with its error name", () => {
    const tail = [
      entry("wake", "burst start", "info"),
      entry("wake", "camera open failed", "warn", { name: "NotAllowedError", message: "denied" }),
    ];
    expect(summariseWakeCapture(tail)).toEqual({
      text: "Last wake capture: camera open failed (NotAllowedError)",
      level: "warn",
    });
  });

  it("reports a zero-upload burst as a warning", () => {
    const tail = [entry("wake", "burst done", "info", { uploaded: 0, of: 3, ms: 2100 })];
    expect(summariseWakeCapture(tail)).toEqual({
      text: "Last burst: 0/3 frames uploaded",
      level: "warn",
    });
  });

  it("reports a partial-upload burst as info", () => {
    const tail = [entry("wake", "burst done", "info", { uploaded: 2, of: 3, ms: 2100 })];
    expect(summariseWakeCapture(tail)).toEqual({
      text: "Last burst: 2/3 frames uploaded",
      level: "info",
    });
  });

  it("reports a camera that never produced a frame", () => {
    const tail = [entry("wake", "camera not ready before burst", "warn", { w: 0, h: 0 })];
    expect(summariseWakeCapture(tail)?.text).toBe(
      "Last wake capture: camera never produced a frame",
    );
  });

  it("prefers the newest terminal outcome across several attempts", () => {
    const tail = [
      entry("wake", "burst done", "info", { uploaded: 3, of: 3 }),
      entry("wake", "camera open failed", "warn", { name: "NotReadableError" }),
    ];
    expect(summariseWakeCapture(tail)).toEqual({
      text: "Last wake capture: camera open failed (NotReadableError)",
      level: "warn",
    });
  });

  it("falls back to the latest line when no terminal event exists", () => {
    const tail = [entry("wake", "burst start", "info")];
    expect(summariseWakeCapture(tail)).toEqual({
      text: "Last wake log: burst start",
      level: "info",
    });
  });
});
