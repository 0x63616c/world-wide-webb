/**
 * BoothCamera , the production photo-booth camera screen, productionized from the
 * approved ApertureV3 prototype. A self-contained full-bleed camera: it opens
 * the front camera, shows a live filtered/mirrored preview, and on shutter bakes
 * the frame(s) and uploads them (via useBoothCapture). It owns only its capture
 * state and filter/timer/flash/mode UI; the host owns navigation, so the only
 * required prop is the gallery jump. `onClose`, when wired, renders a top-left
 * close for full-bleed hosts that lack their own back chrome.
 *
 * Locked behavior (see docs/superpowers/specs/2026-07-19-photo-booth-design.md):
 * one-button timer cycle, top-right filter/timer/flash cluster (flash outermost),
 * 7 CSS filters in a Modal swatch grid, Photo/Burst/4-Frame/GIF modes (Video
 * disabled), screen-flash + countdown/shutter sounds, gallery button bottom-left.
 */

import { useState } from "react";
import { BottomControls, FilterModal, Scrim, TopControls } from "./BoothCameraControls";
import { BoothCaptureKeyframes, CountdownOverlay, FlashOverlay } from "./BoothCountdown";
import { CameraStage } from "./CameraStage";
import { type CountdownOption, isCaptureMode, type ModeValue, nextCountdown } from "./camera-model";
import { useBoothCapture } from "./useBoothCapture";
import { useCameraPreview } from "./useCameraPreview";

export interface BoothCameraProps {
  /** Jump to the gallery (bottom-left button). */
  onOpenGallery: () => void;
  /**
   * Optional close, rendered as a top-left button. Wire it when the host is
   * full-bleed (no back chrome of its own); omit to let the host own back nav.
   */
  onClose?: () => void;
}

export function BoothCamera({ onOpenGallery, onClose }: BoothCameraProps) {
  const preview = useCameraPreview();
  const [filterId, setFilterId] = useState("none");
  const [mode, setMode] = useState<ModeValue>("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // "video" is never a capture mode; the segmented control forbids selecting it,
  // so the fallback is defensive only.
  const captureMode = isCaptureMode(mode) ? mode : "photo";
  const capture = useBoothCapture({
    videoRef: preview.videoRef,
    mode: captureMode,
    filterId,
    countdown,
    flashOn,
  });

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#000",
        fontFamily: "var(--ui)",
        color: "#fff",
        letterSpacing: "-0.01em",
        userSelect: "none",
      }}
    >
      <BoothCaptureKeyframes />
      <CameraStage preview={preview} filterId={filterId} style={{ position: "absolute", inset: 0 }}>
        <Scrim edge="top" />
        <Scrim edge="bottom" />

        <TopControls
          filterId={filterId}
          onOpenFilters={() => setFiltersOpen(true)}
          countdown={countdown}
          onCycleTimer={() => setCountdown(nextCountdown)}
          flashOn={flashOn}
          onToggleFlash={() => setFlashOn((v) => !v)}
          onClose={onClose}
        />

        <CountdownOverlay count={capture.count} />

        <BottomControls
          mode={mode}
          onModeChange={setMode}
          onShoot={capture.shoot}
          onOpenGallery={onOpenGallery}
          capturing={capture.capturing}
          busy={capture.busy}
        />

        {capture.error && <CaptureError message={capture.error} />}

        <FilterModal
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          filterId={filterId}
          onSelect={setFilterId}
        />

        <FlashOverlay active={capture.flashing} />
      </CameraStage>
    </div>
  );
}

/** Transient capture-failure toast, lifted above the bottom cluster. */
function CaptureError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 210,
        transform: "translateX(-50%)",
        padding: "10px 18px",
        borderRadius: 999,
        background: "rgba(20,8,8,0.86)",
        border: "1px solid var(--danger, #e5484d)",
        color: "#fff",
        fontSize: 14,
        fontFamily: "var(--ui)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        zIndex: 45,
        pointerEvents: "none",
      }}
    >
      {message}
    </div>
  );
}
