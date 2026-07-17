/**
 * layout-edit-store , tiny external-store signal for whether the layout editor
 * is open. Modeled on modal-open-store.ts's useSyncExternalStore shape, but a
 * plain boolean (not ref-counted) , there is exactly one layout editor, never
 * several stacked instances.
 *
 * `LayoutEditor` (the wiring component) is mounted unconditionally near the
 * board root and reads `useLayoutEditorOpen()` to decide whether to render;
 * whatever opens the editor (a settings action, a later task) just calls
 * `openLayoutEditor()`.
 */
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openLayoutEditor(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeLayoutEditor(): void {
  if (!open) return;
  open = false;
  emit();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): boolean {
  return open;
}

/** True while the layout editor is open. */
export function useLayoutEditorOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
