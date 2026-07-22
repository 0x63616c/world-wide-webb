/**
 * panel-session , the wall panel's session model. One activity clock; on idle
 * timeout a single SESSION END fires (dim + navigate home + camera glides home +
 * PIN relocks + transient UI resets). See session-store.ts for the clock/state
 * and session-effects.ts for the end fan-out.
 *
 * The public face is the narrow {@link PanelSession} (`panelSession`); the extra
 * wiring/test exports (`setSessionEnabled`, `registerSessionEffects`, ...) are
 * exported standalone, mirroring board-camera's split.
 */

export type SessionPhase = "active" | "ended"; // ended = dimmed, locked, home

export interface PanelSession {
  /** ANY user touch; the only activity source. Wakes an ended session. */
  touch(): void;
  /** Current session phase. */
  phase(): SessionPhase;
  /** Subscribe to the session phase. */
  usePhase(): SessionPhase;
  /** PIN success -> unlocked for the rest of this session. */
  unlock(): void;
  /** True while the current session is unlocked. */
  isUnlocked(): boolean;
  /** Subscribe to the unlock state. */
  useIsUnlocked(): boolean;
  /** Register a session-end callback (the effects fan-out). Returns unregister. */
  onSessionEnd(cb: () => void): () => void;
  /** Set the idle timeout (from settings); default 60_000. Live-rebases. */
  setTimeoutMs(ms: number): void;
}

export {
  registerSessionEffects,
  runSessionEnd,
  type SessionEndEffects,
} from "./session-effects";
export {
  __resetSessionForTests,
  DEFAULT_SESSION_TIMEOUT_MS,
  panelSession,
  setSessionEnabled,
} from "./session-store";
