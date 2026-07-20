/**
 * CameraStage , the booth's live-preview surface. It always renders the <video>
 * (so the getUserMedia stream from useCameraPreview stays attached regardless of
 * overlaid chrome), mirrors it like a selfie cam, and applies the active CSS
 * filter live. When the stream is not live it paints a styled placeholder so
 * stories render cleanly in CI where there is no camera.
 *
 * The <video> is deliberately visually mirrored (scaleX(-1)); the saved frame is
 * un-mirrored in bakeFrame so text/scenes read correctly on disk. Productionized
 * from the throwaway photo-booth-designs prototype.
 */

import { CameraOff } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { filterCss } from "./camera-model";
import type { CameraPreview } from "./useCameraPreview";

interface CameraStageProps {
  preview: CameraPreview;
  /** Active filter id from CAMERA_FILTERS. */
  filterId: string;
  /** Overlaid chrome (controls, HUD) , sits above the video. */
  children?: ReactNode;
  style?: CSSProperties;
}

export function CameraStage({ preview, filterId, children, style }: CameraStageProps) {
  const live = preview.status === "live";

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: "#050505",
        ...style,
      }}
    >
      <video
        ref={preview.videoRef}
        autoPlay
        muted
        playsInline
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: "scaleX(-1)",
          filter: filterCss(filterId),
          transition: "filter 0.25s ease",
          opacity: live ? 1 : 0,
        }}
      />
      {!live && <Fallback detail={preview.detail} />}
      {children}
    </div>
  );
}

function Fallback({ detail }: { detail: string | null }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        color: "var(--ink-3)",
        background: "radial-gradient(120% 120% at 50% 35%, #141414 0%, #0a0a0a 55%, #050505 100%)",
      }}
    >
      <CameraOff size={44} strokeWidth={1.5} />
      <span style={{ fontSize: 15, color: "var(--ink-2)", fontFamily: "var(--ui)" }}>
        {detail ?? "Camera preview"}
      </span>
    </div>
  );
}
