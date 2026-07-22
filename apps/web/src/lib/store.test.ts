/**
 * Tests for createStore (C4): get/set/subscribe plumbing plus the two React
 * hooks built on it. Pins the semantics the brief calls out , identical-value
 * writes (Object.is) don't notify, listeners fire synchronously, and the
 * selector hook only re-renders on a changed slice.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createStore, useStore, useStoreSelector } from "./store";

describe("createStore", () => {
  it("roundtrips the initial value and plain sets", () => {
    const store = createStore(1);
    expect(store.get()).toBe(1);
    store.set(2);
    expect(store.get()).toBe(2);
  });

  it("accepts a functional update over the previous value", () => {
    const store = createStore(1);
    store.set((prev) => prev + 1);
    expect(store.get()).toBe(2);
  });

  it("does not notify listeners when the new value is Object.is-identical", () => {
    const store = createStore({ n: 1 });
    const current = store.get();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(current); // same reference
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies subscribed listeners synchronously on a real change", () => {
    const store = createStore(1);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createStore(1);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(2);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("useStore", () => {
  it("re-renders with the latest value on change", () => {
    const store = createStore(1);
    const { result } = renderHook(() => useStore(store));
    expect(result.current).toBe(1);
    act(() => store.set(2));
    expect(result.current).toBe(2);
  });
});

describe("useStoreSelector", () => {
  it("re-renders only when the selected slice changes (Object.is)", () => {
    const store = createStore({ a: 1, b: 1 });
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useStoreSelector(store, (s) => s.a);
    });
    expect(result.current).toBe(1);
    const rendersAfterMount = renders;

    // Unrelated slice changes , selected value unchanged, no extra render.
    act(() => store.set((prev) => ({ ...prev, b: prev.b + 1 })));
    expect(result.current).toBe(1);
    expect(renders).toBe(rendersAfterMount);

    // Selected slice changes , re-render with the new value.
    act(() => store.set((prev) => ({ ...prev, a: prev.a + 1 })));
    expect(result.current).toBe(2);
    expect(renders).toBe(rendersAfterMount + 1);
  });
});
