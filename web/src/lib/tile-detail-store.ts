/**
 * tile-detail-store , the live "which tile's detail page is open" value.
 *
 * Single seam for opening tile detail pages. When real routing lands, this
 * file's internals become router params; call sites never change.
 *
 * Modeled on open-settings-store, but a LIVE value rather than a one-shot
 * signal: TileDetailHost renders whatever target is current, so opening,
 * switching tiles, and closing are all plain writes here. Nothing anywhere
 * opens a detail page via local state , every entry point (board tap, keyboard
 * activation, in-tile deep links) calls openTileDetail.
 */

import { createStore, useStore } from "./store";

export interface TileDetailTarget {
  /** Board tile id, e.g. "tile_tesla". */
  tileId: string;
  /** Optional variant to land on; the entry's defaultSlug applies when unset. */
  variantSlug?: string;
}

const store = createStore<TileDetailTarget | null>(null);

/** Open (or retarget) the tile detail page for a tile. */
export function openTileDetail(tileId: string, variantSlug?: string): void {
  store.set({ tileId, variantSlug });
}

/** Close the open tile detail page. No-op when none is open. */
export function closeTileDetail(): void {
  store.set(null);
}

/** Live open-detail target (null when no detail page is open). */
export function useTileDetail(): TileDetailTarget | null {
  return useStore(store);
}
