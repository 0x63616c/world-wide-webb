/**
 * Live wall-mount tilt from the device accelerometer.
 *
 * Subscribes to `devicemotion` only while `enabled` (the settings modal or the
 * level view is open) so the always-on board never pays for sensor wakeups.
 * iOS 13+ gates motion events behind a permission prompt that must be raised
 * from a user gesture; `enabled` flips on a tap, so requesting lazily here
 * satisfies that. The published angle is a ROLLING mean of the trailing
 * WINDOW_MS, recomputed on every sensor event: raw accelerometer jitter is
 * ~0.5° at ~60Hz, so the mean is what keeps the readout from shivering, while
 * still tracking a real rotation as fast as the sensor reports it.
 */

import { useEffect, useState } from "react";
import {
  averageWindow,
  cardinalDeviation,
  pitchFromGravity,
  type TiltSample,
  tiltFromGravity,
} from "./tilt";

// Trailing window each published angle averages. Long enough that hand jitter
// and sensor noise cancel, short enough that rotating the mount still feels
// live. The window slides with every reading; it is not a publish interval.
const WINDOW_MS = 250;

export type TiltReading =
  | { state: "unavailable" } // no sensor / permission denied / lying flat
  | { state: "pending" } // waiting for permission or the first event
  | {
      state: "ready";
      /** Roll: rotation within the plane of the wall. Positive = right side high. */
      angle: number;
      /** Pitch: lean out of the wall plane. Positive = top leaning away. */
      pitch: number;
    };

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
    // Pitch rides its own window so the level view can swap axes instantly,
    // without re-subscribing (which on iOS would mean another permission gate).
    const pitchSamples: TiltSample[] = [];

    function onMotion(event: DeviceMotionEvent) {
      const g = event.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      const now = performance.now();

      const pitch = g.z == null ? null : pitchFromGravity(g.x, g.y, g.z);
      if (pitch != null) pitchSamples.push({ t: now, angle: pitch });

      const roll = tiltFromGravity(g.x, g.y, screenAngle());
      if (roll == null) {
        // Lying flat: the mount angle is undefined, and stale samples from
        // before it was laid down must not keep feeding the mean.
        samples.length = 0;
        pitchSamples.length = 0;
        setReading((prev) => (prev.state === "unavailable" ? prev : { state: "unavailable" }));
        return;
      }
      // The panel hangs a whole number of quarter-turns from portrait, and
      // iPadOS can mis-report the webview's screen orientation by 90°; only
      // the deviation from the nearest cardinal angle is a mount error.
      samples.push({ t: now, angle: cardinalDeviation(roll) });

      // Publish on every reading , the smoothing is the trailing mean, NOT a
      // slow publish rate, so a real rotation tracks at the sensor's own pace.
      const mean = averageWindow(samples, now, WINDOW_MS);
      if (mean == null) return;
      const pitchMean = averageWindow(pitchSamples, now, WINDOW_MS);
      // Publish at 0.1° resolution: variation below that is sensor noise, and
      // identical readings skip the re-render entirely.
      const quantized = Math.round(mean * 10) / 10;
      const quantizedPitch = Math.round((pitchMean ?? 0) * 10) / 10;
      setReading((prev) =>
        prev.state === "ready" && prev.angle === quantized && prev.pitch === quantizedPitch
          ? prev
          : { state: "ready", angle: quantized, pitch: quantizedPitch },
      );
    }

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
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [enabled]);

  return reading;
}
