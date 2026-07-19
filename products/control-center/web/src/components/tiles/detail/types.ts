/**
 * Shared types for the tap-to-open tile detail PAGES (full-page overlays).
 *
 * Successor to the modal-era types in ../modals/types.ts: a tile's detail
 * variants are bare page bodies now , no <Modal> chrome, no open/onClose ,
 * hosted by TileDetailHost, which supplies the page shell (portal, header,
 * BackButton) and the floating VariantSwitcher. All variants are fed LIVE tRPC
 * data by the wiring hook , never fixtures (the repo's zero-fake-data rule
 * applies to app runtime).
 */

import type { ReactNode } from "react";

export interface DetailVariant {
  /** Stable id, kebab-case , matches the old modal variant slugs. */
  slug: string;
  /** Short human label shown in the floating switcher. */
  label: string;
  /** Renders the variant's bare page content , NO <Modal>. */
  render: () => ReactNode;
}

export interface TileDetailPageEntry {
  kind: "page";
  /** Matches the board tile id, e.g. "tile_tesla". */
  tileId: string;
  /** Header title, matches the tile label. */
  title: string;
  /** PIN-gated (Activity): the host runs PinGateModal before the page mounts. */
  requiresPin?: true;
  /** Default variant slug shown first when the tile is tapped. */
  defaultSlug: string;
  /**
   * Live-data hook, called only while the page is open (active-only child, so
   * hooks rules hold and closed tiles never run their queries) , same contract
   * as the old TileModalEntry.useVariants.
   */
  useVariants: () => { variants: DetailVariant[]; loading: boolean };
}

export interface TileDetailActionEntry {
  kind: "action";
  /** Matches the board tile id, e.g. "tile_felogs". */
  tileId: string;
  /** Runs instead of opening a page, e.g. Frontend Logs → openSettingsOnPage("logs"). */
  run: () => void;
}

export type TileDetailEntry = TileDetailPageEntry | TileDetailActionEntry;
