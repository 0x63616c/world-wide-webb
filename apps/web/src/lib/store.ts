/**
 * createStore , the shared useSyncExternalStore primitive every hand-rolled
 * singleton store in this repo (settings.ts, device-settings.ts,
 * tile-detail-store.ts, the time-suite stores, ...) re-implemented from
 * scratch. This is that plumbing extracted once: a module keeps its own
 * `const store = createStore(initial)`, expresses its setters via `store.set`,
 * and exposes `useStore`/`useStoreSelector` for components. Everything else
 * about a store , persistence, server sinks, clamping, tickers , stays with the
 * module that owns that domain; this file has no opinion on any of it.
 *
 * No persistence, no async, no middleware , YAGNI. Every existing store needs
 * exactly get/set/subscribe plus a selector-aware read.
 */

import { useSyncExternalStore } from "react";

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    get(): T {
      return state;
    },
    set(next: T | ((prev: T) => T)): void {
      const value = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribe to a store's whole value. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * Subscribe to a derived slice of a store's value. Re-renders only when the
 * selected slice changes (Object.is) , useSyncExternalStore already applies
 * that gate by comparing the getSnapshot return across renders, so this is
 * just `get` composed with `selector`.
 */
export function useStoreSelector<T, U>(store: Store<T>, selector: (state: T) => U): U {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}
