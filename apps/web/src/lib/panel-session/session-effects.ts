/**
 * panel-session effects , the session-end fan-out, registered once at app mount.
 *
 * When the activity clock expires the store flips phase active→ended and drops
 * any unlock (the "ended ⇒ locked" invariant, owned by session-store), THEN
 * fires the registered end-listeners. This module IS that listener: it runs the
 * teardown that returns the wall to a clean, home-positioned board:
 *
 *   dim the backlight → close the open tile-detail page → dismiss every
 *   dismissable modal (Settings, PIN gates, …) → glide the camera home.
 *
 * Every side effect is INJECTED (see {@link SessionEndEffects}) so the fan-out
 * order is unit-testable with spies; the prod wiring (Board) passes the real
 * `dimTo` / `closeTileDetail` / `dismissAllModals` / `boardCamera.glideHome`.
 *
 * Two things the brief lists as fan-out steps live elsewhere by design:
 *   - "clear unlock" is intrinsic to the store's end transition (it fires before
 *     these effects), since there is no public relock on the PanelSession face.
 *   - "drop pending-settings" is obviated by deleting open-settings-store; the
 *     Settings deep-link target is component-local now and resets when the gate
 *     relocks and the page is dismissed here.
 */

import { panelSession } from "./session-store";

export interface SessionEndEffects {
  /** Drop the panel backlight to the idle level (native-only in prod). */
  dim(): void;
  /** Close any open full-page tile detail. */
  closeTileDetail(): void;
  /** Dismiss every dismissable modal so the board itself is what's shown. */
  clearModals(): void;
  /** Glide the board camera back to the home tile. */
  glideHome(): void;
}

/**
 * Run the session-end teardown in order. Dim first (the panel is going to
 * sleep), then strip everything off the board, then home the camera behind the
 * now-clear board , gliding home while an overlay is still up would home a board
 * nobody can see.
 */
export function runSessionEnd(fx: SessionEndEffects): void {
  fx.dim();
  fx.closeTileDetail();
  fx.clearModals();
  fx.glideHome();
}

/**
 * Register the session-end fan-out. Call once at app mount; returns an
 * unregister for symmetry / tests.
 */
export function registerSessionEffects(fx: SessionEndEffects): () => void {
  return panelSession.onSessionEnd(() => runSessionEnd(fx));
}
