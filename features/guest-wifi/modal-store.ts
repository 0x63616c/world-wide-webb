/**
 * guest-wifi-modal-store , open/close signal for the Guest Wi-Fi QR modal.
 *
 * The board's tap path resolves ONLY through the tile-detail registry, and the
 * Guest tile's detail is deliberately a SMALL modal, not a full detail page ,
 * so its registry entry is an action that flips this flag, and GuestWifiTile
 * (always mounted on the board) subscribes and renders the modal. Mirrors the
 * open-settings-store pattern.
 */

import { createStore, useStore } from "@/lib/store";

const store = createStore(false);

export function openGuestWifiModal(): void {
  store.set(true);
}

export function closeGuestWifiModal(): void {
  store.set(false);
}

export function useGuestWifiModalOpen(): boolean {
  return useStore(store);
}
