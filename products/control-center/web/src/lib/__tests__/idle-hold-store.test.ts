/**
 * idle-hold-store contract: token-object holds (never keyed by reason),
 * idempotent releases, and the two hooks the Board + detail wiring consume.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireIdleHold,
  resetIdleHoldsForTests,
  useIdleHeld,
  useIdleHoldWhile,
} from "../idle-hold-store";

afterEach(() => {
  cleanup();
  resetIdleHoldsForTests();
});

describe("acquireIdleHold", () => {
  it("counts holds, not reasons: two holds sharing a reason are independent", () => {
    const { result } = renderHook(() => useIdleHeld());
    expect(result.current).toBe(false);

    let release1: () => void = () => {};
    let release2: () => void = () => {};
    act(() => {
      release1 = acquireIdleHold("clock-detail-live");
      release2 = acquireIdleHold("clock-detail-live");
    });
    expect(result.current).toBe(true);

    act(() => release1());
    // The sibling hold (same reason) must survive.
    expect(result.current).toBe(true);

    act(() => release2());
    expect(result.current).toBe(false);
  });

  it("release is idempotent , double-releasing one hold never frees another", () => {
    const { result } = renderHook(() => useIdleHeld());
    let release1: () => void = () => {};
    act(() => {
      release1 = acquireIdleHold("a");
      acquireIdleHold("b");
    });
    act(() => {
      release1();
      release1();
      release1();
    });
    expect(result.current).toBe(true); // "b" still holds
  });
});

describe("useIdleHoldWhile", () => {
  it("holds exactly while active, releasing on flip and on unmount", () => {
    const held = renderHook(() => useIdleHeld());

    const hook = renderHook(({ active }) => useIdleHoldWhile(active, "clock-detail-live"), {
      initialProps: { active: false },
    });
    expect(held.result.current).toBe(false);

    hook.rerender({ active: true });
    expect(held.result.current).toBe(true);

    hook.rerender({ active: false });
    expect(held.result.current).toBe(false);

    hook.rerender({ active: true });
    expect(held.result.current).toBe(true);
    hook.unmount();
    expect(held.result.current).toBe(false);
  });
});
