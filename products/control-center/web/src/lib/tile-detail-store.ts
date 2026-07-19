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

import { useSyncExternalStore } from "react";

export interface TileDetailTarget {
  /** Board tile id, e.g. "tile_tesla". */
  tileId: string;
  /** Optional variant to land on; the entry's defaultSlug applies when unset. */
  variantSlug?: string;
}

let target: TileDetailTarget | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open (or retarget) the tile detail page for a tile. */
export function openTileDetail(tileId: string, variantSlug?: string): void {
  target = { tileId, variantSlug };
  emit();
}

/** Close the open tile detail page. No-op when none is open. */
export function closeTileDetail(): void {
  if (target === null) return;
  target = null;
  emit();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): TileDetailTarget | null {
  return target;
}

/** Live open-detail target (null when no detail page is open). */
export function useTileDetail(): TileDetailTarget | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
