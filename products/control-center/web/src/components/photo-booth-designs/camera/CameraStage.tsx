/**
 * CameraStage , the shared live-preview surface every design drops into its
 * layout. It always renders the <video> (so the getUserMedia stream from
 * useCameraPreview stays attached regardless of chrome), mirrors it like a
 * selfie cam, and applies the active CSS filter. When the stream is not live it
 * paints a styled placeholder over the top so stories still render cleanly in
 * CI where there is no camera.
 *
 * Designs compose their own controls as `children` (rendered above the video)
 * and can fully restyle the fallback via `fallback`.
 */

import { CameraOff } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { filterCss } from "./camera-shared";
import type { CameraPreview } from "./useCameraPreview";

interface CameraStageProps {
  preview: CameraPreview;
  /** Active filter id from CAMERA_FILTERS. */
  filterId: string;
  /** Overlaid chrome (controls, frames, HUD) , sits above the video. */
  children?: ReactNode;
  /** Per-concept placeholder shown when the stream is not live. */
  fallback?: ReactNode;
  /** Extra CSS filter appended after the selected preview filter. */
  extraFilter?: string;
  className?: string;
  style?: CSSProperties;
  /** Border radius on the clipped preview (frames want square, most want soft). */
  radius?: number;
  /** Object-fit for the video , cover by default; contain for framed concepts. */
  fit?: "cover" | "contain";
}

export function CameraStage({
  preview,
  filterId,
  children,
  fallback,
  extraFilter,
  className,
  style,
  radius = 0,
  fit = "cover",
}: CameraStageProps) {
  const live = preview.status === "live";
  const filter = extraFilter ? `${filterCss(filterId)} ${extraFilter}` : filterCss(filterId);

  return (
    <div
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: radius,
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
          objectFit: fit,
          transform: "scaleX(-1)",
          filter,
          transition: "filter 0.25s ease",
          opacity: live ? 1 : 0,
        }}
      />
      {!live && (fallback ?? <DefaultFallback detail={preview.detail} />)}
      {children}
    </div>
  );
}

function DefaultFallback({ detail }: { detail: string | null }) {
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
