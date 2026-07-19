/**
 * dogmode-preview-store , the shared "Dog Mode armed (preview)" flag.
 *
 * Dog Mode is still a placeholder , the routine is not wired to the house, and
 * arming it toggles a local preview only. That preview now shows in two places
 * (the tile face and the full-page detail), so the flag lives here instead of
 * component state: arming on the page arms the face too, one truth instead of
 * two diverging previews. Modeled on open-settings-store.
 *
 * When Dog Mode is actually connected to the house this store dies and the
 * armed state comes from the api like every other live control.
 */

import { useSyncExternalStore } from "react";

let armed = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Flip the preview arm flag (no hardware side effects , preview only). */
export function toggleDogModePreview(): void {
  armed = !armed;
  emit();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): boolean {
  return armed;
}

/** Live preview-armed flag, shared by the tile face and the detail page. */
export function useDogModePreview(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
