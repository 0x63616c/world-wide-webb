/**
 * Live wall-mount tilt from the device accelerometer.
 *
 * Subscribes to `devicemotion` only while `enabled` (the settings modal or the
 * level view is open) so the always-on board never pays for sensor wakeups.
 * iOS 13+ gates motion events behind a permission prompt that must be raised
 * from a user gesture; `enabled` flips on a tap, so requesting lazily here
 * satisfies that. Readings are averaged over a trailing window and published
 * once per window , raw accelerometer jitter is ~0.5° at ~60Hz and the level
 * view should settle, not shiver.
 */

import { useEffect, useState } from "react";
import { averageWindow, cardinalDeviation, type TiltSample, tiltFromGravity } from "./tilt";

// Trailing window that each published angle averages, and the interval at
// which it is published. Long enough that hand jitter and sensor noise cancel,
// short enough that rotating the mount still feels live.
const WINDOW_MS = 250;

export type TiltReading =
  | { state: "unavailable" } // no sensor / permission denied / lying flat
  | { state: "pending" } // waiting for permission or the first event
  | { state: "ready"; angle: number };

// iOS 13+ puts a permission gate on motion events; other platforms omit it.
type PermissionedDeviceMotion = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

function screenAngle(): number {
  return window.screen?.orientation?.angle ?? 0;
}

export function useTiltAngle(enabled: boolean): TiltReading {
  const [reading, setReading] = useState<TiltReading>({ state: "pending" });

  useEffect(() => {
    if (!enabled) return;
    if (typeof DeviceMotionEvent === "undefined") {
      setReading({ state: "unavailable" });
      return;
    }

    let cancelled = false;
    const samples: TiltSample[] = [];
    // The sensor firing at all is what separates "no readings yet" from "lying
    // flat, so the mount angle is undefined".
    let sawEvent = false;

    function onMotion(event: DeviceMotionEvent) {
      const g = event.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      sawEvent = true;
      const roll = tiltFromGravity(g.x, g.y, screenAngle());
      if (roll == null) return;
      // The panel hangs a whole number of quarter-turns from portrait, and
      // iPadOS can mis-report the webview's screen orientation by 90°; only
      // the deviation from the nearest cardinal angle is a mount error.
      samples.push({ t: performance.now(), angle: cardinalDeviation(roll) });
    }

    // One publish per window instead of one per reading: ~4 re-renders a
    // second rather than ~60, and the displayed angle is an honest 250ms mean.
    const publish = window.setInterval(() => {
      const mean = averageWindow(samples, performance.now(), WINDOW_MS);
      if (mean == null) {
        if (sawEvent)
          setReading((prev) => (prev.state === "unavailable" ? prev : { state: "unavailable" }));
        return;
      }
      // Publish at 0.1° resolution: variation below that is sensor noise, and
      // identical readings skip the re-render entirely.
      const quantized = Math.round(mean * 10) / 10;
      setReading((prev) =>
        prev.state === "ready" && prev.angle === quantized
          ? prev
          : { state: "ready", angle: quantized },
      );
    }, WINDOW_MS);

    async function subscribe() {
      const requestPermission = (DeviceMotionEvent as PermissionedDeviceMotion).requestPermission;
      if (requestPermission) {
        try {
          const result = await requestPermission();
          if (cancelled) return;
          if (result !== "granted") {
            setReading({ state: "unavailable" });
            return;
          }
        } catch {
          if (!cancelled) setReading({ state: "unavailable" });
          return;
        }
      }
      window.addEventListener("devicemotion", onMotion);
    }

    setReading({ state: "pending" });
    void subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(publish);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [enabled]);

  return reading;
}
