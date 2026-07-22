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
import { interaction } from "./log/interaction";

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

// Both transitions are only ever reached from a deliberate action (a settings
// button, the editor's own done/cancel), so they belong on the human channel.
export function openLayoutEditor(): void {
  if (open) return;
  open = true;
  interaction("modal", "open", "layout-editor");
  emit();
}

export function closeLayoutEditor(): void {
  if (!open) return;
  open = false;
  interaction("modal", "close", "layout-editor");
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
