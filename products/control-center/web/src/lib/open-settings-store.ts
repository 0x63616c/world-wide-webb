/**
 * open-settings-store , a one-shot "open Settings on page X" signal.
 *
 * SettingsButton owns the PIN gate and the page overlay, so a tile that wants to
 * deep-link into a specific Settings page (the Frontend Logs tile → the Logs
 * page) cannot open it directly , it would bypass the gate and duplicate the
 * overlay. Instead it drops a pending page here; SettingsButton subscribes,
 * opens its gate, and on a correct PIN lands the overlay on that page.
 *
 * One-shot on purpose: `consumePendingSettingsPage` clears the pending value as
 * it reads it, so a request fires exactly once and a later plain gear tap opens
 * on Device rather than re-triggering the last deep link.
 */

import { useSyncExternalStore } from "react";
import type { PageKey } from "../components/settings-page/pages";

let pending: PageKey | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Request that Settings open (behind the PIN gate) on a specific page. */
export function openSettingsOnPage(page: PageKey): void {
  pending = page;
  emit();
}

/** Read and clear the pending page. Returns null when nothing is pending. */
export function consumePendingSettingsPage(): PageKey | null {
  const page = pending;
  pending = null;
  return page;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): PageKey | null {
  return pending;
}

/** Subscribe to the pending deep-link page (null when none is queued). */
export function usePendingSettingsPage(): PageKey | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
