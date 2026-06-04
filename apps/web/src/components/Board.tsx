import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  BOARD_H,
  BOARD_PADDING,
  BOARD_W,
  GRID_COLS,
  GRID_GAP,
  GRID_ROWS,
} from "../lib/grid-constants";
import { deriveGridAreas, TILE_REGISTRY, type TileRegistryEntry } from "../lib/tile-registry";
import { ConnectionLostBanner } from "./ConnectionLostBanner";
import { getTileModalEntry } from "./tiles/modals/registry";
import { TileModalHost } from "./tiles/modals/TileModalHost";
import type { TileModalEntry } from "./tiles/modals/types";
import { TileBoundary } from "./ui/TileBoundary";
import { ViewportDebug } from "./ViewportDebug";

// Interactive descendants a tap may land on (toggles, sliders, the Controls
// "More" button). Taps on these drive the tile's own controls and must NOT also
// open the detail modal; taps anywhere else on the tile open it.
const INTERACTIVE_SELECTOR = 'button, input, a, select, textarea, [role="slider"]';

const GRID_AREAS = deriveGridAreas(TILE_REGISTRY);

// White device bezel drawn around the panel when — and only when — the viewport
// has room to spare beyond the panel. The bezel ADDS to the rendered footprint,
// so it must never appear on a screen that is exactly panel-sized (the iPad wall
// panel): there it would push the panel off by its own width. Geometry, not the
// build mode, decides this — the wall panel runs the same dev server, so an
// env flag can't tell device from preview, but viewport size always can.
const BEZEL = 10;

// Pairs QueryErrorResetBoundary with TileBoundary via resetKey so a recovered
// query resets the boundary without unmounting or a full page reload.
function BoundedTile({ children }: { children: React.ReactNode }) {
  const [resetKey, setResetKey] = useState(0);
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <TileBoundary
          resetKey={resetKey}
          onReset={() => {
            reset();
            setResetKey((k) => k + 1);
          }}
        >
          {children}
        </TileBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

/**
 * The fixed 1366x1024 board, always centered in the viewport. When the window
 * is larger than the panel it renders at true 1:1 inside a white device bezel;
 * otherwise — including the iPad wall panel, where the viewport equals the
 * panel — it letterbox-fits bare so it renders pixel-identically. The choice is
 * pure geometry (see BEZEL), so it is correct on every surface with no env flag.
 *
 * Layout is driven entirely by TILE_REGISTRY — adding a tile there places it
 * on the board with no further changes required here.
 */
export function Board() {
  const scalerRef = useRef<HTMLDivElement>(null);
  // Which tile's detail modal is open (null = none).
  const [activeModal, setActiveModal] = useState<TileModalEntry | null>(null);
  // True when the viewport is large enough to also draw the white bezel around
  // the panel at true 1:1. False on the wall panel (viewport == panel) and on
  // any window too small, where the panel is letterbox-fit instead.
  const [framed, setFramed] = useState(false);

  // Open a tile's detail modal for taps on the tile body, not on an inner control.
  // Tiles that own their tap (ownsTap) open their own modal, so the board leaves
  // them alone; tiles with no registered modal simply don't open anything.
  function openTile(entry: TileRegistryEntry, e: React.MouseEvent<HTMLDivElement>) {
    if (entry.ownsTap) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    const modal = getTileModalEntry(entry.id);
    if (modal) setActiveModal(modal);
  }

  useEffect(() => {
    const el = scalerRef.current;
    // When the window has room for panel + bezel on both axes, draw the bezel
    // and render the panel at true 1:1 (it is guaranteed to fit, so plain
    // centering suffices — no scrolling or overflow tricks). Otherwise letterbox
    // the bare panel to fit (scale = 1 on the iPad, where the panel == viewport).
    const apply = () => {
      const fits =
        window.innerWidth >= BOARD_W + 2 * BEZEL && window.innerHeight >= BOARD_H + 2 * BEZEL;
      setFramed(fits);
      if (el) {
        const s = fits ? 1 : Math.min(window.innerWidth / BOARD_W, window.innerHeight / BOARD_H);
        el.style.transform = `scale(${s})`;
      }
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  // #scaler is the 1366x1024 box that establishes the positioning context for
  // the tile detail modal (it renders position:fixed inset:0, bounded by this
  // transformed ancestor), keeping the modal inside the panel rather than the
  // whole desktop. Its transform is set imperatively by the effect above.
  const scaler = (
    <div
      id="scaler"
      ref={scalerRef}
      style={{ width: BOARD_W, height: BOARD_H, transformOrigin: "center center" }}
    >
      <div className="board e-root" style={{ padding: BOARD_PADDING }}>
        <ConnectionLostBanner />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
            gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
            gridTemplateAreas: GRID_AREAS,
            gap: GRID_GAP,
          }}
        >
          {TILE_REGISTRY.map((entry) => {
            const { id, component: TileComponent, gridArea, label } = entry;
            return (
              // Not a real <button>: the tile body contains its own buttons
              // (toggles, sliders, "More"), and nesting interactive elements is
              // invalid. role+tabIndex give the wrapper button semantics while
              // keeping inner controls separately operable.
              // biome-ignore lint/a11y/useSemanticElements: nested interactive content forbids a <button>
              <div
                key={id}
                style={{ gridArea, cursor: "pointer" }}
                role="button"
                tabIndex={0}
                aria-label={`Open ${label}`}
                onClick={(e) => openTile(entry, e)}
                // Keyboard activation only when the tile wrapper itself is
                // focused — keep Enter/Space on inner controls for those controls.
                onKeyDown={(e) => {
                  if (entry.ownsTap) return;
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    const modal = getTileModalEntry(entry.id);
                    if (!modal) return;
                    e.preventDefault();
                    setActiveModal(modal);
                  }
                }}
              >
                <BoundedTile>
                  <TileComponent />
                </BoundedTile>
              </div>
            );
          })}
        </div>
      </div>
      <TileModalHost entry={activeModal} onClose={() => setActiveModal(null)} />
    </div>
  );

  // One tree for every surface. The panel is always centered in the viewport.
  // When there is room to spare, it sits at true 1:1 inside a white bezel (10px
  // border, 10px outer radius); otherwise — including the iPad wall panel, where
  // the viewport equals the panel — it renders bare and letterbox-fit. Because
  // the bezel only appears when the framed box already fits, plain centering is
  // enough: nothing ever overflows, so no scrolling or start-edge clipping.
  return (
    <div
      id="stage"
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        background: "#000",
      }}
    >
      {framed ? (
        <div style={{ border: `${BEZEL}px solid #fff`, borderRadius: BEZEL }}>{scaler}</div>
      ) : (
        scaler
      )}
      {/* TEMP: viewport diagnostic — remove once the bezel threshold is settled. */}
      <ViewportDebug />
    </div>
  );
}
