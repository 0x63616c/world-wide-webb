/**
 * Tests for useGroupMembership hook.
 *
 * Membership analog of useMixer's poll-reconcile gate (www-tavs): a polled
 * snapshot may only overwrite a room's membership when it was FETCHED after
 * that room's last local edit (dataUpdatedAt > lastEditAt[uuid]).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGroupMembership } from "../hooks/useGroupMembership";

describe("useGroupMembership, poll reconcile gated on fetch time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds member from the first poll", () => {
    const polled = { "uuid-A": "src-1", "uuid-B": null };
    const { result } = renderHook(() => useGroupMembership(polled, 10_000));
    expect(result.current.member["uuid-A"]).toBe("src-1");
    expect(result.current.member["uuid-B"]).toBeNull();
  });

  it("optimistic setMember survives a stale snapshot (same dataUpdatedAt)", () => {
    const polled = { "uuid-A": "src-1" };
    const { result, rerender } = renderHook(({ polled, at }) => useGroupMembership(polled, at), {
      initialProps: { polled, at: 10_000 },
    });
    expect(result.current.member["uuid-A"]).toBe("src-1");

    // Local edit at t=10s.
    act(() => result.current.setMember("uuid-A", "src-2"));
    expect(result.current.member["uuid-A"]).toBe("src-2");

    // Re-render replays the SAME snapshot (dataUpdatedAt unchanged, i.e. not
    // fetched after the edit) — must not overwrite the optimistic value.
    rerender({ polled: { "uuid-A": "src-1" }, at: 10_000 });
    expect(result.current.member["uuid-A"]).toBe("src-2");
  });

  it("a newer snapshot (fetched after the edit) overwrites", () => {
    const polled = { "uuid-A": "src-1" };
    const { result, rerender } = renderHook(({ polled, at }) => useGroupMembership(polled, at), {
      initialProps: { polled, at: 9_000 },
    });

    // Local edit at t=10s.
    act(() => result.current.setMember("uuid-A", "src-2"));
    expect(result.current.member["uuid-A"]).toBe("src-2");

    // Next poll lands at t=15s, fetched AFTER the edit — the system wins.
    vi.setSystemTime(15_000);
    rerender({ polled: { "uuid-A": "src-3" }, at: 15_000 });
    expect(result.current.member["uuid-A"]).toBe("src-3");
  });

  it("prunes rooms absent from the poll", () => {
    const initialPolled = { "uuid-A": "src-1", "uuid-B": "src-2" };
    const { result, rerender } = renderHook(({ polled, at }) => useGroupMembership(polled, at), {
      initialProps: { polled: initialPolled, at: 10_000 },
    });
    expect(Object.keys(result.current.member)).toHaveLength(2);

    rerender({ polled: { "uuid-A": "src-1" }, at: 20_000 });
    expect(Object.keys(result.current.member)).toHaveLength(1);
    expect(result.current.member["uuid-B"]).toBeUndefined();
  });

  it("stable-reference guard: no render loop when poll returns unchanged values", () => {
    const polled = { "uuid-A": "src-1" };
    let renderCount = 0;
    const { rerender } = renderHook(
      ({ polled, at }) => {
        renderCount++;
        return useGroupMembership(polled, at);
      },
      { initialProps: { polled, at: 10_000 } },
    );
    const baseRenderCount = renderCount;

    for (let i = 0; i < 10; i++) {
      rerender({ polled, at: 20_000 + i });
    }

    expect(renderCount).toBeLessThanOrEqual(baseRenderCount + 20);
  });
});
