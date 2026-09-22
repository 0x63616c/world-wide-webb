/**
 * modal-open-store , a tiny ref-counted "is any modal open" signal.
 *
 * Every <Modal> registers here while open. Board uses the count to avoid
 * opening a tile detail when a click inside a tile-owned, portalled modal
 * replays through the tile wrapper's React event tree.
 */

import { createStore, useStore } from "./store";

const store = createStore(0);
// Dismissers for the currently-open modals, in registration order. Only modals
// that opt in (by passing onDismiss) appear here — see dismissAllModals.
const dismissers = new Set<() => void>();

/**
 * Mark a modal as open. Call on mount/open and invoke the returned disposer on
 * unmount/close so the count stays balanced even if several modals overlap.
 *
 * `onDismiss` opts this modal into {@link dismissAllModals}: pass the modal's
 * close handler so the board's idle reset can tear the panel back down to the
 * clock. Omit it for overlays that own their own lifetime and must survive an
 * idle window (the screen-cleaning mode, whose whole point is to ignore input
 * for its duration).
 */
export function registerOpenModal(onDismiss?: () => void): () => void {
  if (onDismiss) dismissers.add(onDismiss);
  store.set((count) => count + 1);
  let released = false;
  return () => {
    if (released) return; // idempotent: a double-cleanup must not underflow
    released = true;
    if (onDismiss) dismissers.delete(onDismiss);
    store.set((count) => count - 1);
  };
}

/**
 * Close every modal that opted in via `registerOpenModal(onDismiss)`.
 *
 * Drives the board's idle reset: an unattended panel returns to the clock, and
 * "the clock" means the board's home view with nothing on top of it — gliding
 * the camera home behind an open Settings panel leaves the wall showing a modal
 * nobody opened. Iterates a copy because each dismiss synchronously unregisters.
 */
export function dismissAllModals(): void {
  for (const dismiss of [...dismissers]) dismiss();
}

/** True while one or more modals are open. Drives the board's pan freeze. */
export function useAnyModalOpen(): boolean {
  return useStore(store) > 0;
}
