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
import { deriveGridAreas, TILE_REGISTRY } from "../lib/tile-registry";
import { ConnectionLostBanner } from "./ConnectionLostBanner";
import { TileBoundary } from "./ui/TileBoundary";

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
            {TILE_REGISTRY.map(({ id, component: TileComponent, gridArea }) => (
              <div key={id} style={{ gridArea }}>
                <BoundedTile>
                  <TileComponent />
                </BoundedTile>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
