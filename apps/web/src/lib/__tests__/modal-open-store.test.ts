import { renderHook } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { registerOpenModal, useAnyModalOpen } from "../modal-open-store";

// Every test balances its own registrations, leaving the global count at 0.
describe("modal-open-store", () => {
  it("reports closed when no modal is registered", () => {
    const { result } = renderHook(() => useAnyModalOpen());
    expect(result.current).toBe(false);
  });

  it("reports open while a modal is registered and closed once released", () => {
    const { result } = renderHook(() => useAnyModalOpen());
    let release: () => void = () => {};
    act(() => {
      release = registerOpenModal();
    });
    expect(result.current).toBe(true);
    act(() => release());
    expect(result.current).toBe(false);
  });

  it("stays open until the LAST overlapping modal releases (ref-counted)", () => {
    const { result } = renderHook(() => useAnyModalOpen());
    let releaseA: () => void = () => {};
    let releaseB: () => void = () => {};
    act(() => {
      releaseA = registerOpenModal();
      releaseB = registerOpenModal();
    });
    expect(result.current).toBe(true);
    act(() => releaseA());
    expect(result.current).toBe(true); // B still open
    act(() => releaseB());
    expect(result.current).toBe(false);
  });

  it("does not underflow if a disposer is called twice", () => {
    const { result } = renderHook(() => useAnyModalOpen());
    let release: () => void = () => {};
    act(() => {
      release = registerOpenModal();
    });
    act(() => {
      release();
      release(); // double cleanup must be a no-op, not a negative count
    });
    expect(result.current).toBe(false);

    // A fresh registration after the double-release still flips to open,
    // proving the count wasn't driven negative.
    let release2: () => void = () => {};
    act(() => {
      release2 = registerOpenModal();
    });
    expect(result.current).toBe(true);
    act(() => release2());
    expect(result.current).toBe(false);
  });
});
