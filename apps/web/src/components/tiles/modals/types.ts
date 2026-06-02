/**
 * Shared types for the tap-to-open tile detail modals + variant switcher.
 *
 * Each board tile can have several designed detail-modal *variants* (see the
 * sibling Modal*.tsx files, each a pure prop-driven view). A tile's wiring module
 * exposes them as LiveVariants: a stable list of {slug,label,render} where render
 * injects open/onClose into that variant's own <Modal>. The switcher swaps which
 * variant renders. All variants are fed LIVE tRPC data by the wiring hook — never
 * fixtures (the repo's zero-fake-data rule applies to app runtime).
 */

import type { ReactNode } from "react";

export interface LiveVariant {
  /** Stable id, kebab-case (matches the modal's Storybook story slug). */
  slug: string;
  /** Short human label shown in the floating switcher. */
  label: string;
  /** Renders the variant's own <Modal>, with open/onClose injected. */
  render: (open: boolean, onClose: () => void) => ReactNode;
}

export interface TileModalEntry {
  /** Matches the board tile id, e.g. "tile_weath". */
  tileId: string;
  /** Default variant slug shown first when the tile is tapped. */
  defaultSlug: string;
  /**
   * Hook returning the tile's live variants + a loading flag. Called only while
   * the tile's modal is open (inside an active-only child), so hooks rules hold
   * and closed tiles never run their queries.
   */
  useVariants: () => { variants: LiveVariant[]; loading: boolean };
}
