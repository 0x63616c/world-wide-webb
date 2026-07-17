/**
 * Live wall-mount tilt from the device accelerometer.
 *
 * Subscribes to `devicemotion` only while `enabled` (the settings modal or the
 * level view is open) so the always-on board never pays for sensor wakeups.
 * iOS 13+ gates motion events behind a permission prompt that must be raised
 * from a user gesture; `enabled` flips on a tap, so requesting lazily here
 * satisfies that. Readings are lightly low-pass filtered , raw accelerometer
 * jitter is ~0.5° and the level view should settle, not shiver.
 */

import { useEffect, useRef, useState } from "react";
import { tiltFromGravity } from "./tilt";

// Fraction of each new reading blended into the smoothed angle. ~12 readings
// to converge, which at the ~60Hz devicemotion rate reads as instant.
const SMOOTHING = 0.25;

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
  const smoothed = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof DeviceMotionEvent === "undefined") {
      setReading({ state: "unavailable" });
      return;
    }

    let cancelled = false;

    function onMotion(event: DeviceMotionEvent) {
      const g = event.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      const angle = tiltFromGravity(g.x, g.y, screenAngle());
      if (angle == null) {
        smoothed.current = null;
        setReading({ state: "unavailable" });
        return;
      }
      smoothed.current =
        smoothed.current == null
          ? angle
          : smoothed.current + (angle - smoothed.current) * SMOOTHING;
      setReading({ state: "ready", angle: smoothed.current });
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
    smoothed.current = null;
    void subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [enabled]);

  return reading;
}
