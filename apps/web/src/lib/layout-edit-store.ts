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
import { interaction } from "./log/interaction";
import { createStore, useStore } from "./store";

const store = createStore(false);

// Both transitions are only ever reached from a deliberate action (a settings
// button, the editor's own done/cancel), so they belong on the human channel.
export function openLayoutEditor(): void {
  if (store.get()) return;
  interaction("modal", "open", "layout-editor");
  store.set(true);
}

export function closeLayoutEditor(): void {
  if (!store.get()) return;
  interaction("modal", "close", "layout-editor");
  store.set(false);
}

/** True while the layout editor is open. */
export function useLayoutEditorOpen(): boolean {
  return useStore(store);
}
