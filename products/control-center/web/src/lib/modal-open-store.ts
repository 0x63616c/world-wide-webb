/**
 * modal-open-store , a tiny ref-counted "is any modal open" signal.
 *
 * Every <Modal> registers here while open, so the board can freeze its pan
 * whenever ANY modal is up , not only modals routed through the board's own
 * `activeModal` state. A tile that manages its own modal (e.g. ControlsTile's
 * expanded view) opens a <Modal> too, so it counts here as well.
 *
 * WHY this exists: the shared <Modal> portals to <body>, but in the React tree
 * it is still a descendant of the pannable #stage. React replays portal events
 * up the React tree (not the DOM tree), so a press on a modal's backdrop bubbles
 * into #stage's onPointerDown and drives the board drag-pan. Freezing the board
 * on this count (rather than on `activeModal`) closes that hole for every modal.
 */

import { useSyncExternalStore } from "react";

let openCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Mark a modal as open. Call on mount/open and invoke the returned disposer on
 * unmount/close so the count stays balanced even if several modals overlap.
 */
export function registerOpenModal(): () => void {
  openCount += 1;
  emit();
  let released = false;
  return () => {
    if (released) return; // idempotent: a double-cleanup must not underflow
    released = true;
    openCount -= 1;
    emit();
  };
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): number {
  return openCount;
}

/** True while one or more modals are open. Drives the board's pan freeze. */
export function useAnyModalOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot) > 0;
}
