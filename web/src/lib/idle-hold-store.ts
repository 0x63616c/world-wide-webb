/**
 * idle-hold-store , the seam that lets a feature suppress the board's idle
 * behaviors (glide-home reset + backlight dim) while something live is on
 * screen, e.g. the clock detail page with a running timer.
 *
 * Board.tsx reads `useIdleHeld()` into the same `enabled` expressions that
 * `layoutEditOpen` already gates, so the hooks themselves need no changes.
 *
 * Holds are a Set of unique token OBJECTS , the `reason` string rides along as
 * metadata for logging, and is deliberately NOT the key: two concurrent holds
 * sharing a reason must never collide (releasing one must not release both).
 */

import { useEffect } from "react";
import { log } from "./log/logger";
import { createStore, useStore } from "./store";

const holdLog = log.child("idle-hold");

interface HoldToken {
  reason: string;
}

const holds = new Set<HoldToken>();
const store = createStore(false);

function sync(): void {
  store.set(holds.size > 0);
}

/**
 * Acquire an idle hold. Returns an idempotent release. The board stays awake
 * (no glide-home, no dim) while ANY hold is live.
 *
 * @public , deliberate imperative surface (clock-suite plan §3): app code
 * reaches it through useIdleHoldWhile today; exported for non-React callers.
 */
export function acquireIdleHold(reason: string): () => void {
  const token: HoldToken = { reason };
  holds.add(token);
  holdLog.info("acquired", { reason, holds: holds.size });
  sync();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds.delete(token);
    holdLog.info("released", { reason, holds: holds.size });
    sync();
  };
}

/** True while any idle hold is live. Board.tsx folds this into the idle
 *  hooks' `enabled` expressions. */
export function useIdleHeld(): boolean {
  return useStore(store);
}

/**
 * Declarative hold: held exactly while `active` is true (and this component is
 * mounted). The conditional-hold pattern for detail pages , pass
 * `open && somethingLive` so a dormant page still idles home.
 */
export function useIdleHoldWhile(active: boolean, reason: string): void {
  useEffect(() => {
    if (!active) return;
    return acquireIdleHold(reason);
  }, [active, reason]);
}

/** @public , test seam (vitest); intentionally unused in app code. */
export function resetIdleHoldsForTests(): void {
  holds.clear();
  sync();
}
