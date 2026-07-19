/**
 * guest-wifi-modal-store , open/close signal for the Guest Wi-Fi QR modal.
 *
 * The board's tap path resolves ONLY through the tile-detail registry, and the
 * Guest tile's detail is deliberately a SMALL modal, not a full detail page ,
 * so its registry entry is an action that flips this flag, and GuestWifiTile
 * (always mounted on the board) subscribes and renders the modal. Mirrors the
 * open-settings-store pattern.
 */

import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function openGuestWifiModal(): void {
  open = true;
  emit();
}

export function closeGuestWifiModal(): void {
  open = false;
  emit();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function useGuestWifiModalOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
