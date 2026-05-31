/**
 * TileShowcaseModal — opens when a board tile is tapped and presents that tile's
 * MAIN component first, exactly as Storybook showcases it: the live tile rendered
 * at its true production footprint (cols/rows → pixels, via tilePixelSize) inside
 * an `e-root` box, on the board background.
 *
 * Generic over every tile: it renders the registry entry's container `component`,
 * so the showcase reuses the already-cached tRPC query and mirrors the board
 * pixel-for-pixel — no per-tile wiring. Tile-specific detail can be layered BELOW
 * the showcase later; the showcase is always the first thing in the modal.
 */

import { createElement } from "react";
import { tilePixelSize } from "../../lib/grid-constants";
import type { TileRegistryEntry } from "../../lib/tile-registry";
import { Modal } from "../ui";

export interface TileShowcaseModalProps {
  // The tapped tile, or null when nothing is open. Driving open off the entry
  // keeps a single source of truth (which tile) rather than a parallel boolean.
  entry: TileRegistryEntry | null;
  onClose: () => void;
}

export function TileShowcaseModal({ entry, onClose }: TileShowcaseModalProps) {
  // Title must exist even while closed (Modal reads it); harmless placeholder
  // since the Modal renders nothing when not open.
  const title = entry?.label ?? "";
  const size = entry ? tilePixelSize(entry.cols, entry.rows) : null;

  return (
    <Modal open={entry !== null} onClose={onClose} title={title}>
      {entry && size && (
        // The showcase: the tile's main component at production size, in an
        // e-root box on the board bg — the same presentation Storybook uses.
        <div
          data-testid="tile-showcase"
          className="e-root"
          style={{
            width: size.width,
            height: size.height,
            display: "flex",
            flexDirection: "column",
            background: "var(--bg)",
            // Centre the fixed-size showcase within the wider modal body.
            margin: "0 auto",
          }}
        >
          {createElement(entry.component)}
        </div>
      )}
    </Modal>
  );
}
