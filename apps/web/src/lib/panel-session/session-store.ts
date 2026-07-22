/**
 * panel-session store , the wall panel's single activity clock and the phase +
 * unlock state that hang off it. Replaces the four scattered idle/PIN
 * mechanisms (idle-dim timer, idle-reset timer, per-page PIN gate, the
 * pending-settings deep link) with one model:
 *
 *   - ONE countdown, rearmed by `touch()` (the only activity source).
 *   - On expiry a single SESSION END fires: `phase` flips active→ended and any
 *     unlock is dropped, THEN the registered end-listeners run (the effects
 *     fan-out lives in session-effects.ts). "ended" means dimmed + locked +
 *     home , there is no separate "dim early" stage.
 *   - Nothing defers session end (roadmap decision 4): a 1000-hour kitchen timer
 *     must not hold the panel unlocked. The clock only stops when the feature is
 *     turned off (`setSessionEnabled(false)`), never because something is live.
 *
 * The clock is OFF until the app enables it (`setSessionEnabled`) , so merely
 * importing this module never schedules a global timer (test + Storybook
 * hygiene). Board owns the gating (native-only, idle-dim setting, layout-edit)
 * and feeds `setTimeoutMs` from settings; the store has no opinion on any of it.
 */

import { createStore, useStore } from "../store";
import type { PanelSession, SessionPhase } from "./index";

/** Default session timeout , matches today's idle-dim default (60s). */
export const DEFAULT_SESSION_TIMEOUT_MS = 60_000;

interface SessionState {
  phase: SessionPhase;
  unlocked: boolean;
}

const store = createStore<SessionState>({ phase: "active", unlocked: false });

// Clock config + handle. Held outside the store value: they are not rendered,
// only the derived phase/unlock is. `enabled` starts false so the module is
// inert at import (see file header).
let timeoutMs = DEFAULT_SESSION_TIMEOUT_MS;
let enabled = false;
let timer: ReturnType<typeof setTimeout> | null = null;

// Fired (in registration order) the instant the session ends. session-effects
// registers the real fan-out here; kept a plain Set so registration is O(1) and
// order is stable.
const endListeners = new Set<() => void>();

/**
 * (Re)arm the countdown. A single writer for `timer` so every rearm path
 * (touch, setTimeoutMs, enable) funnels through the same guard: the clock runs
 * only while enabled AND active. A no-op teardown otherwise.
 */
function arm(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!enabled) return;
  if (store.get().phase !== "active") return;
  timer = setTimeout(endSession, timeoutMs);
}

/**
 * End the session: drop any unlock and flip to "ended" BEFORE the end-listeners
 * run, so the fan-out (and anything it triggers) always observes a locked,
 * ended session , the "ended ⇒ locked" invariant. Guarded so a stray timer can
 * never end an already-ended session twice.
 */
function endSession(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (store.get().phase !== "active") return;
  store.set({ phase: "ended", unlocked: false });
  for (const listener of endListeners) listener();
}

/**
 * Register a session-end callback (the effects fan-out). Returns an idempotent
 * unregister.
 */
function onSessionEnd(cb: () => void): () => void {
  endListeners.add(cb);
  return () => {
    endListeners.delete(cb);
  };
}

/** ANY user touch , the only activity source. Wakes an ended session and
 *  (re)arms the clock. */
function touch(): void {
  if (store.get().phase === "ended") {
    // Wake into a fresh, still-locked session (unlock was dropped at end).
    store.set((s) => ({ ...s, phase: "active" }));
  }
  arm();
}

/** Current session phase. */
function phase(): SessionPhase {
  return store.get().phase;
}

/** Subscribe to the session phase. */
function usePhase(): SessionPhase {
  return useStore(store).phase;
}

/** PIN success , unlocked for the rest of THIS session (dropped at session end). */
function unlock(): void {
  if (store.get().unlocked) return;
  store.set((s) => ({ ...s, unlocked: true }));
}

/** True while the current session is unlocked. */
function isUnlocked(): boolean {
  return store.get().unlocked;
}

/** Subscribe to the unlock state. */
function useIsUnlocked(): boolean {
  return useStore(store).unlocked;
}

/** Set the idle timeout (from settings). Live-rebases the running clock. */
function setTimeoutMs(ms: number): void {
  timeoutMs = ms;
  arm();
}

/**
 * Turn the session clock on/off. Off = the feature is disabled (idle-dim off,
 * off-device, or layout-edit): the clock stops and, if the panel was already
 * ended, it wakes back to a fresh locked session so nothing stays dimmed with
 * the feature off. Not part of the public {@link PanelSession} face , Board
 * wiring only, mirroring board-camera's extra standalone exports.
 */
export function setSessionEnabled(on: boolean): void {
  if (enabled === on) {
    // Re-assert the clock even on a no-op flip so a stage/settings churn that
    // re-runs the effect doesn't strand a stopped clock.
    arm();
    return;
  }
  enabled = on;
  if (!on && store.get().phase === "ended") {
    store.set((s) => ({ ...s, phase: "active" }));
  }
  arm();
}

/** @public , test seam (vitest); resets all state + the clock. */
export function __resetSessionForTests(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  enabled = false;
  timeoutMs = DEFAULT_SESSION_TIMEOUT_MS;
  endListeners.clear();
  store.set({ phase: "active", unlocked: false });
}

/** The panel-session singleton , the locked public face (see PanelSession). */
export const panelSession: PanelSession = {
  touch,
  phase,
  usePhase,
  unlock,
  isUnlocked,
  useIsUnlocked,
  onSessionEnd,
  setTimeoutMs,
};
