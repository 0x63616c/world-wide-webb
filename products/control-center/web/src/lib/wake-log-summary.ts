/**
 * wake-log-summary , read the panel's own `wake`-source log entries back into a
 * one-line "why are there no photos" readout for the Activity page's empty
 * state. The capture chain is best-effort and logs every failure (see
 * wake-capture.ts); surfacing the most recent outcome makes an empty gallery
 * self-diagnosable on the wall instead of a silent mystery.
 *
 * Pure and dependency-light: it takes the log tail and returns a status (or
 * null), so it is unit-testable and the component around it just subscribes.
 */

import type { LogEntry } from "./log/types";

export interface WakeCaptureStatus {
  /** A human one-liner, e.g. "Last burst: 0/3 frames uploaded". */
  text: string;
  /** Whether the outcome was a problem (warn) or routine (info). */
  level: "info" | "warn";
}

function record(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v ? v : fallback;
}

/** Map a terminal wake entry to a readout, or null if it's not terminal. */
function terminalReadout(entry: LogEntry): WakeCaptureStatus | null {
  const data = record(entry.data);
  switch (entry.msg) {
    case "camera open failed":
      return {
        text: `Last wake capture: camera open failed (${str(data.name, "error")})`,
        level: "warn",
      };
    case "burst failed":
      return {
        text: `Last wake capture: burst failed (${str(data.name, "error")})`,
        level: "warn",
      };
    case "camera not ready before burst":
      return { text: "Last wake capture: camera never produced a frame", level: "warn" };
    case "burst done": {
      const uploaded = Number(data.uploaded ?? 0);
      const of = Number(data.of ?? 3);
      return {
        text: `Last burst: ${uploaded}/${of} frames uploaded`,
        level: uploaded > 0 ? "info" : "warn",
      };
    }
    default:
      return null;
  }
}

/**
 * Summarise the most recent wake-capture outcome from the log tail, or null when
 * there are no `wake`-source entries at all (so the caller shows plain empty
 * copy). Prefers the newest terminal outcome (open failed / burst done / …);
 * falls back to the newest wake line so an in-flight or unknown state still says
 * something rather than nothing.
 */
export function summariseWakeCapture(tail: LogEntry[]): WakeCaptureStatus | null {
  const wake = tail.filter((e) => e.source === "wake");
  if (wake.length === 0) return null;
  for (let i = wake.length - 1; i >= 0; i--) {
    const readout = terminalReadout(wake[i]);
    if (readout) return readout;
  }
  // No terminal event yet (e.g. only "burst start" shipped): report the latest
  // line so nothing is hidden.
  const latest = wake[wake.length - 1];
  return {
    text: `Last wake log: ${latest.msg}`,
    level: latest.level === "warn" || latest.level === "error" ? "warn" : "info",
  };
}
