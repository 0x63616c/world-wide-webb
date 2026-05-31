import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ConnectionLostBanner } from "./ConnectionLostBanner";
import { ClimateTile } from "./tiles/ClimateTile";
import { ClockGreeting } from "./tiles/ClockGreeting";
import { ControlsTile } from "./tiles/ControlsTile";
import { DogCamTile } from "./tiles/DogCamTile";
import { EventsTile } from "./tiles/EventsTile";
import { NetworkTile } from "./tiles/NetworkTile";
import { Next12Hours } from "./tiles/Next12Hours";
import { TeslaTile } from "./tiles/TeslaTile";
import { WeatherNow } from "./tiles/WeatherNow";
import { TileBoundary } from "./ui/TileBoundary";

const BOARD_W = 1366;
const BOARD_H = 1024;

// 12-col x 6-row bento. Per spec: Next 12 Hours top-middle, Dog Cam bottom-middle.
const GRID_AREAS = [
  "clock clock clock clock clock weath weath weath weath wifi wifi wifi",
  "clock clock clock clock clock weath weath weath weath wifi wifi wifi",
  "tesla tesla tesla tesla hourly hourly hourly hourly ctrl ctrl ctrl ctrl",
  "tesla tesla tesla tesla hourly hourly hourly hourly ctrl ctrl ctrl ctrl",
  "tesla tesla tesla tesla dogcam dogcam dogcam dogcam ac ac ac ac",
  "event event event event dogcam dogcam dogcam dogcam ac ac ac ac",
]
  .map((row) => `"${row}"`)
  .join(" ");

// Wraps one tile grid cell with QueryErrorResetBoundary (render-prop form) so
// that when a query resets, reset() increments resetKey and TileBoundary clears
// its error state — recovery without unmounting the parent tree.
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
 * BoundedTile pairs QueryErrorResetBoundary with TileBoundary via resetKey so a
 * recovered query resets the boundary without unmounting or a full page reload.
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
        <div className="board e-root" style={{ padding: 26 }}>
          <ConnectionLostBanner />
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "grid",
              gridTemplateColumns: "repeat(12, 1fr)",
              gridTemplateRows: "repeat(6, 1fr)",
              gridTemplateAreas: GRID_AREAS,
              gap: 18,
            }}
          >
            <div style={{ gridArea: "clock" }}>
              <BoundedTile>
                <ClockGreeting />
              </BoundedTile>
            </div>
            <div style={{ gridArea: "weath" }}>
              <BoundedTile>
                <WeatherNow />
              </BoundedTile>
            </div>
            <div style={{ gridArea: "wifi" }}>
              <BoundedTile>
                <NetworkTile />
              </BoundedTile>
            </div>
            <div style={{ gridArea: "tesla" }}>
              <BoundedTile>
                <TeslaTile />
              </BoundedTile>
            </div>
            <div style={{ gridArea: "hourly" }}>
              <BoundedTile>
                <Next12Hours />
              </BoundedTile>
            </div>
            <div style={{ gridArea: "ctrl" }}>
              <BoundedTile>
                <ControlsTile />
              </BoundedTile>
            </div>
            <div style={{ gridArea: "dogcam" }}>
              <BoundedTile>
                <DogCamTile />
              </BoundedTile>
            </div>
            <div style={{ gridArea: "ac" }}>
              <BoundedTile>
                <ClimateTile />
              </BoundedTile>
            </div>
            <div style={{ gridArea: "event" }}>
              <BoundedTile>
                <EventsTile />
              </BoundedTile>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
