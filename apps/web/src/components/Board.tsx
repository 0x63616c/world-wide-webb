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

// Interactive descendants a tap may land on (toggles, sliders, the Controls
// "More" button). Taps on these drive the tile's own controls and must NOT also
// open the detail modal; taps anywhere else on the tile open it.
const INTERACTIVE_SELECTOR = 'button, input, a, select, textarea, [role="slider"]';

const GRID_AREAS = deriveGridAreas(TILE_REGISTRY);

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
 * The fixed 1366x1024 board. A #scaler wrapper scales the board uniformly to
 * fit the viewport (letterboxed), matching the design's fit() behavior so the
 * iPad wall panel and any browser window render pixel-identically.
 *
 * Layout is driven entirely by TILE_REGISTRY — adding a tile there places it
 * on the board with no further changes required here.
 */
export function Board() {
  const scalerRef = useRef<HTMLDivElement>(null);
  // Which tile's detail modal is open (null = none).
  const [activeModal, setActiveModal] = useState<TileModalEntry | null>(null);

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
    if (!el) return;
    const fitToViewport = () => {
      const s = Math.min(window.innerWidth / BOARD_W, window.innerHeight / BOARD_H);
      el.style.transform = `scale(${s})`;
    };
    fitToViewport();
    window.addEventListener("resize", fitToViewport);
    return () => window.removeEventListener("resize", fitToViewport);
  }, []);

  return (
    <div id="stage" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center" }}>
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
    </div>
  );
}
