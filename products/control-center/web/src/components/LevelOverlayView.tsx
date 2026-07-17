/**
 * LevelOverlayView , the full-screen spirit level, iPhone Level style.
 *
 * A white plane fills the screen below a horizon line that rotates with the
 * live tilt: positive angles lift its RIGHT edge (the mount's right side is
 * high). Within the flat zone the whole screen floods the app accent blue and
 * the readout snaps to 0°. Dumb view: angle in, one tap out , the sensor and
 * portal live in LevelOverlay.
 */

import { formatTilt, isLevel } from "../lib/tilt";
import type { TiltReading } from "../lib/useTiltAngle";

// Oversized so the rotated plane's corners never expose the backdrop, even at
// extreme angles on the 1366x1024 panel.
const PLANE_OVERDRAW = "-60%";

const DASH: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  width: 70,
  height: 2,
};

export interface LevelOverlayViewProps {
  reading: TiltReading;
  onClose: () => void;
}

export function LevelOverlayView({ reading, onClose }: LevelOverlayViewProps) {
  const ready = reading.state === "ready";
  const angle = ready ? reading.angle : 0;
  const level = ready && isLevel(angle);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: full-screen tap-anywhere dismiss surface; Escape handling lives in the container
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <div
      data-testid="level-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        overflow: "hidden",
        background: level ? "var(--acc)" : "#000",
        fontFamily: "var(--ui)",
        cursor: "pointer",
      }}
    >
      {!level && (
        <div
          style={{
            position: "absolute",
            left: PLANE_OVERDRAW,
            right: PLANE_OVERDRAW,
            top: "-160%",
            height: "210%",
            background: "#fff",
            // CSS rotate is clockwise-positive: -angle lifts the right edge
            // of the plane for a positive (right-side-high) tilt.
            transform: `rotate(${-angle}deg)`,
            transformOrigin: "50% 100%",
          }}
        />
      )}

      <div style={{ ...DASH, left: "22%", background: level ? "#fff" : "#888" }} />
      <div style={{ ...DASH, right: "22%", background: level ? "#fff" : "#888" }} />

      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          fontSize: 150,
          fontWeight: 500,
          lineHeight: 1,
          color: "#fff",
          // Over the split plane the readout must survive both halves; over
          // the blue flood it stays plain white (difference on blue reads
          // orange, which is exactly what we don't want).
          mixBlendMode: level ? "normal" : "difference",
        }}
      >
        {ready ? formatTilt(angle) : "--"}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 36,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 14,
          color: level ? "rgba(255,255,255,0.8)" : "#888",
          mixBlendMode: level ? "normal" : "difference",
        }}
      >
        {reading.state === "unavailable"
          ? "Tilt unavailable on this device. Tap anywhere to close."
          : "Rotate the mount toward 0. Tap anywhere to close."}
      </div>
    </div>
  );
}
