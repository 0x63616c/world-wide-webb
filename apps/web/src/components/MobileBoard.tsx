/**
 * MobileBoard , the phone view. What you get when this app is opened on an
 * iPhone instead of on the wall panel.
 *
 * The board (Board.tsx) is a pannable 1366x1024 world with idle dim, a wall of
 * tiles and a banner stack. None of that survives translation to a phone: you
 * cannot pan a 64x64-cell world with a thumb, and the banner that matters on a
 * docked panel ("set your device name") is a setup nag about the PANEL, shown
 * on a device that is not one. So the phone gets its own screen rather than a
 * squeezed board , a
 * scroll column holding just the two things you actually reach for your phone
 * to do: the quick Controls (lamps / lights / fan) and Climate · A/C.
 *
 * Deliberately NOT here, and each for a reason:
 *   - The banner stack. Every banner in it is panel chrome, and the one the
 *     phone view exists to silence self-guards (see DeviceNameBanner), so
 *     mounting it from a phone would still render nothing.
 *   - Drag-pan, the camera glide and idle dim , all are properties of a fixed
 *     panel sitting on a wall, not of a phone in a pocket.
 *
 * Still here, because a phone needs them: the Settings gear (the phone is where
 * you fix a setting you noticed on the panel) and TileDetailHost (the tile
 * faces' own "more" buttons open a detail page, and those pages already handle
 * safe-area insets and cap their own width).
 *
 * Which tiles: PHONE_TILE_IDS below, resolved through the same App registry the
 * board reads, so a phone tile is a real App tile with its real wiring , no
 * parallel component tree, nothing to keep in sync.
 */

import { registryEntryForTileId } from "@features/_generated/web.gen";
import type { CSSProperties, ReactNode } from "react";
import { tilePixelSize } from "../lib/grid-constants";
import { openTileDetail } from "../lib/tile-detail-store";
import { SettingsButton } from "./SettingsButton";
import { TileDetailHost } from "./tiles/detail/TileDetailHost";
import { BoundedTile } from "./ui/BoundedTile";

/**
 * The phone view's contents, in display order: quick Controls first, then
 * Climate · A/C.
 *
 * A curated ORDERED list, which is why it lives here rather than as a
 * `phone: true` flag on each App manifest (the way `home` and guest exposure
 * work): an App can declare that it is home, or guest-exposed, without knowing
 * anything about the others, but it cannot declare that it comes before Climate.
 * Ordering is a property of this screen, so this screen owns it.
 *
 * Both ids are checked against the live registry by
 * __tests__/MobileBoard.test.tsx , a typo'd or deleted id fails the suite rather
 * than silently rendering an emptier phone view.
 */
export const PHONE_TILE_IDS = ["tile_ctrl", "tile_ac"] as const;

/** One card in the phone column: a real tile face, sized and tappable. */
export interface MobileTileCard {
  readonly id: string;
  /** Tile label , the card's accessible name ("Open Controls"). */
  readonly label: string;
  /** width / height of the panel tile this card mirrors (see MobileBoardView). */
  readonly aspect: number;
  readonly content: ReactNode;
  /** Opens this tile's detail page. Omitted when the tile has no detail. */
  readonly onOpen?: () => void;
}

// Interactive descendants a tap may land on. Same list (and same reason) as
// Board's: a tap on a toggle, slider or the "more" button drives that control
// and must NOT also open the detail page; a tap anywhere else on the card does.
const INTERACTIVE_SELECTOR = 'button, input, a, select, textarea, [role="slider"]';

const scrollStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  overflowY: "auto",
  overflowX: "hidden",
  background: "var(--bg)",
  color: "var(--ink)",
  fontFamily: "var(--ui)",
  // Momentum scrolling on iOS WebKit; harmless everywhere else.
  WebkitOverflowScrolling: "touch",
};

const columnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  // index.html sets viewport-fit=cover, so the top inset is what keeps the
  // first card out from under the notch / Dynamic Island. The bottom padding
  // clears BOTH the home indicator and the Settings gear floating over the
  // column, so the last card can always be scrolled fully clear of it.
  padding:
    "calc(14px + env(safe-area-inset-top, 0px)) 14px calc(96px + env(safe-area-inset-bottom, 0px))",
  boxSizing: "border-box",
};

// Fixed layer for the floating gear. pointer-events:none so it never eats a
// scroll gesture over the column (SettingsButton opts its own button back in,
// exactly as it does on the board). The safe-area padding shifts the gear off
// the home indicator: an absolutely positioned child resolves `bottom`/`right`
// against its containing block's PADDING box, so padding here moves the gear
// without touching SettingsButton.
const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
  zIndex: 200,
  paddingBottom: "env(safe-area-inset-bottom, 0px)",
  paddingRight: "env(safe-area-inset-right, 0px)",
};

/**
 * Presentational phone column , no registry, no store, no tRPC. Exported for
 * Storybook and for tests that want to drive the cards directly.
 *
 * Each card keeps the exact aspect ratio its panel tile has (the container
 * passes `aspect` straight from the grid's tile size), so a tile face designed
 * against a 4x3 board cell renders at the proportions it was designed for ,
 * just narrower. Height therefore follows width, and the column scrolls.
 */
function MobileBoardView({ tiles }: { tiles: readonly MobileTileCard[] }) {
  return (
    <div id="mobile-stage" data-testid="mobile-stage" style={scrollStyle}>
      <div style={columnStyle}>
        {tiles.map(({ id, label, aspect, content, onOpen }) => (
          // Not a real <button>: the tile face contains its own buttons
          // (toggles, sliders, "more") and nesting interactive elements is
          // invalid. role+tabIndex give the card button semantics while keeping
          // those inner controls separately operable , same compromise Board
          // makes for the same reason.
          // biome-ignore lint/a11y/useSemanticElements: nested interactive content forbids a <button>
          <div
            key={id}
            role="button"
            tabIndex={0}
            aria-label={`Open ${label}`}
            style={{
              aspectRatio: aspect,
              flex: "0 0 auto",
              cursor: onOpen ? "pointer" : "default",
            }}
            onClickCapture={(e) => {
              if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
              onOpen?.();
            }}
            onKeyDown={(e) => {
              // Enter/Space open the detail page like a tap on the face would;
              // keys inside inner controls stay theirs.
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen?.();
              }
            }}
          >
            {content}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Resolves PHONE_TILE_IDS against the App registry into renderable cards.
 *  Plain function, not a hook , it reads the static registry and calls nothing
 *  stateful. */
function phoneTileCards(): MobileTileCard[] {
  return PHONE_TILE_IDS.flatMap((id) => {
    const entry = registryEntryForTileId(id);
    // A curated id that no longer resolves (App renamed/removed) drops out
    // rather than crashing the phone view; the unit test is what makes that
    // loud at build time instead of silent in your hand.
    if (!entry) return [];
    const { width, height } = tilePixelSize(entry.cols, entry.rows);
    const TileComponent = entry.component;
    return [
      {
        id: entry.id,
        label: entry.label,
        aspect: width / height,
        content: (
          <BoundedTile>
            <TileComponent />
          </BoundedTile>
        ),
        onOpen: () => {
          openTileDetail(entry.id);
        },
      },
    ];
  });
}

export function MobileBoard() {
  const tiles = phoneTileCards();

  return (
    <>
      <MobileBoardView tiles={tiles} />
      <div style={overlayStyle}>
        <SettingsButton />
      </div>
      <TileDetailHost />
    </>
  );
}
