/**
 * settings-overlay-store , the live "is the Settings overlay open, and on which
 * page" control. Successor to the deleted open-settings-store one-shot.
 *
 * open-settings-store existed to queue a page ACROSS the PIN gate (a tile
 * deep-linking into Settings had to survive the gate to land on its page). With
 * panel-session's shared, session-wide Unlock that survives-across-the-gate
 * dance is gone: a deep link just sets the overlay target here, and
 * SettingsButton renders it behind the SAME session gate (`useIsUnlocked`) it
 * uses for a plain gear tap. No more consume/one-shot , this is a plain live
 * value, and session end resets it by dismissing the overlay (modal-open-store).
 *
 * SettingsButton owns the gate + the level/clean sub-overlays; this store owns
 * only whether Settings is up and where it should land , the single seam a
 * board tile (Frontend Logs) uses to open Settings without a prop path.
 */

import type { PageKey } from "../components/settings-page/pages";
import { createStore, useStore } from "./store";

interface SettingsOverlayState {
  open: boolean;
  /** Landing page for this open; null opens on the default (Device) page. */
  page: PageKey | null;
}

const store = createStore<SettingsOverlayState>({ open: false, page: null });

/** Open the Settings overlay, optionally landing on a specific page. */
export function openSettings(page?: PageKey): void {
  store.set({ open: true, page: page ?? null });
}

/** Close the Settings overlay. */
export function closeSettings(): void {
  store.set({ open: false, page: null });
}

/** Live Settings-overlay target (SettingsButton renders it behind the gate). */
export function useSettingsOverlay(): SettingsOverlayState {
  return useStore(store);
}
