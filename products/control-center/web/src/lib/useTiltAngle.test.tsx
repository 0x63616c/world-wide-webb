/**
 * Publishing semantics of useTiltAngle. The math lives in tilt.test.ts; what is
 * pinned here is WHEN a reading surfaces , the readout must track the sensor's
 * own rate while showing a trailing mean, not update once per window.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTiltAngle } from "./useTiltAngle";

const G = 9.81;

// A gravity reading for a panel whose right side has DROPPED by `deg`, in
// portrait. Positive deg therefore surfaces as a NEGATIVE (right-side-low) roll.
function motion(deg: number, gz = 0): DeviceMotionEvent {
  const rad = (deg * Math.PI) / 180;
  return new (class extends Event {
    accelerationIncludingGravity = { x: G * Math.sin(rad), y: -G * Math.cos(rad), z: gz };
  })("devicemotion") as unknown as DeviceMotionEvent;
}

function dispatch(deg: number, gz = 0) {
  act(() => {
    window.dispatchEvent(motion(deg, gz));
  });
}

describe("useTiltAngle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("publishes on every reading, without waiting out the window", () => {
    const { result } = renderHook(() => useTiltAngle(true));
    expect(result.current.state).toBe("pending");

    // A single reading is enough to surface an angle: no timer has elapsed.
    dispatch(2);
    expect(result.current).toMatchObject({ state: "ready", angle: -2 });
  });

  it("shows the mean of the trailing window, so jitter cancels", () => {
    const { result } = renderHook(() => useTiltAngle(true));

    // Alternating ±2° of sensor noise around level, all inside one window.
    dispatch(2);
    dispatch(-2);
    if (result.current.state !== "ready") throw new Error("expected a reading");
    expect(result.current.angle).toBeCloseTo(0, 5);
  });

  it("drops samples older than the window, so the mean follows a real move", () => {
    const { result } = renderHook(() => useTiltAngle(true));

    dispatch(10);
    // Wait out the window, then hold steady at a new angle: the old reading has
    // aged out and must no longer drag the mean toward 10.
    act(() => vi.advanceTimersByTime(300));
    dispatch(4);
    expect(result.current).toMatchObject({ state: "ready", angle: -4 });
  });

  it("reports unavailable while lying flat", () => {
    const { result } = renderHook(() => useTiltAngle(true));

    dispatch(2);
    expect(result.current.state).toBe("ready");

    // Face-up: gravity has no usable in-plane component.
    act(() => {
      window.dispatchEvent(
        new (class extends Event {
          accelerationIncludingGravity = { x: 0, y: 0, z: G };
        })("devicemotion") as unknown as DeviceMotionEvent,
      );
    });
    expect(result.current.state).toBe("unavailable");
  });

  it("stays inert while disabled", () => {
    const { result } = renderHook(() => useTiltAngle(false));
    dispatch(2);
    expect(result.current.state).toBe("pending");
  });
});
