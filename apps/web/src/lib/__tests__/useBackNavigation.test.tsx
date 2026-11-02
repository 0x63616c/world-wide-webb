import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBackNavigation } from "../useBackNavigation";

afterEach(cleanup);

function touch(x: number, y: number, identifier = 1) {
  return { clientX: x, clientY: y, identifier };
}
function swipe(x = 10, endX = 120, endY = 104, target: Element | Window = window) {
  fireEvent.touchStart(target, { touches: [touch(x, 100)] });
  fireEvent.touchMove(target, { touches: [touch(endX, endY)] });
  fireEvent.touchEnd(target, { touches: [], changedTouches: [touch(endX, endY)] });
}

describe("useBackNavigation", () => {
  it("uses the latest callback without reordering surfaces, and cleans up", () => {
    const old = vi.fn();
    const latest = vi.fn();
    const hook = renderHook(({ back }) => useBackNavigation(back), { initialProps: { back: old } });
    hook.rerender({ back: latest });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(latest).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(old).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    hook.unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    swipe();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("only navigates the topmost surface for Escape and an edge swipe", () => {
    const page = vi.fn();
    const dialog = vi.fn();
    renderHook(() => useBackNavigation(page));
    const top = renderHook(() => useBackNavigation(dialog));
    fireEvent.keyDown(window, { key: "Escape" });
    swipe();
    expect(dialog).toHaveBeenCalledTimes(2);
    expect(page).not.toHaveBeenCalled();
    top.unmount();
    swipe();
    expect(page).toHaveBeenCalledTimes(1);
  });

  it.each([
    [25, 140, 100, "non-edge"],
    [10, 90, 100, "short"],
    [10, 120, 200, "diagonal"],
    [10, -120, 100, "leftward"],
  ])("ignores %s → %s, %s (%s)", (x, endX, endY) => {
    const back = vi.fn();
    renderHook(() => useBackNavigation(back));
    swipe(x, endX, endY);
    expect(back).not.toHaveBeenCalled();
  });

  it("does not hijack sliders, cancelled, vertical or multi-touch gestures", () => {
    const back = vi.fn();
    renderHook(() => useBackNavigation(back));
    const slider = document.createElement("input");
    slider.type = "range";
    document.body.append(slider);
    swipe(10, 120, 100, slider);
    slider.remove();
    fireEvent.touchStart(window, { touches: [touch(10, 100)] });
    fireEvent.touchMove(window, { touches: [touch(12, 140)] });
    fireEvent.touchEnd(window, { touches: [], changedTouches: [touch(150, 100)] });
    fireEvent.touchStart(window, { touches: [touch(10, 100)] });
    fireEvent.touchCancel(window);
    fireEvent.touchEnd(window, { touches: [], changedTouches: [touch(150, 100)] });
    fireEvent.touchStart(window, { touches: [touch(10, 100), touch(20, 100, 2)] });
    fireEvent.touchEnd(window, { touches: [], changedTouches: [touch(150, 100)] });
    expect(back).not.toHaveBeenCalled();
  });

  it("does not prevent normal horizontal scrolling; claims only edge drags", () => {
    renderHook(() => useBackNavigation(vi.fn()));
    fireEvent.touchStart(window, { touches: [touch(100, 100)] });
    expect(fireEvent.touchMove(window, { touches: [touch(240, 100)] })).toBe(true);
    fireEvent.touchStart(window, { touches: [touch(10, 100)] });
    expect(fireEvent.touchMove(window, { touches: [touch(110, 100)] })).toBe(false);
  });

  it("does not deliver an in-flight swipe to a newly opened dialog", () => {
    const page = vi.fn();
    const dialog = vi.fn();
    renderHook(() => useBackNavigation(page));
    fireEvent.touchStart(window, { touches: [touch(10, 100)] });
    renderHook(() => useBackNavigation(dialog));
    fireEvent.touchEnd(window, { touches: [], changedTouches: [touch(150, 100)] });
    expect(page).not.toHaveBeenCalled();
    expect(dialog).not.toHaveBeenCalled();
  });
});
