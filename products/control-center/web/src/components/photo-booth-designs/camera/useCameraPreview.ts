/**
 * useCameraPreview , the single shared getUserMedia hook behind every
 * Photo-booth camera design. Opens the front camera once on mount, wires the
 * stream into the caller's <video> element, and tears the stream down on
 * unmount. Every design renders the same live selfie preview from this hook;
 * only the surrounding chrome differs.
 *
 * Mirrors the exact getUserMedia call in src/lib/wake-capture.ts (facingMode
 * "user", audio off) so the design prototypes exercise the same code path the
 * real wake burst uses , but this hook is preview-only and never uploads.
 *
 * Failure is a first-class state, not an exception: in Storybook/CI there is
 * usually no camera and no permission, so `status` resolves to "denied" /
 * "error" / "unsupported" and each design paints its own styled placeholder
 * instead of a broken black box.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus =
  /** getUserMedia in flight , stream not attached yet. */
  | "starting"
  /** Live stream attached and playing. */
  | "live"
  /** Permission explicitly refused (NotAllowedError). */
  | "denied"
  /** No device, or any other getUserMedia failure. */
  | "error"
  /** navigator.mediaDevices.getUserMedia is absent (old/locked-down runtime). */
  | "unsupported";

export interface CameraPreview {
  /** Attach to the design's <video> element. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  /** Human-readable reason for a non-live status, for placeholder copy. */
  detail: string | null;
  /** Re-attempt getUserMedia (e.g. a "Try again" affordance in the fallback). */
  retry: () => void;
}

const DENIED_COPY = "Camera access is off";
const ERROR_COPY = "No camera available";
const UNSUPPORTED_COPY = "Camera not supported here";

export function useCameraPreview(): CameraPreview {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<CameraStatus>("starting");
  const [detail, setDetail] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is a bump counter , it is deliberately the only dep so retry() re-opens the camera, and it is not referenced in the body.
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setStatus("unsupported");
      setDetail(UNSUPPORTED_COPY);
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;

    setStatus("starting");
    setDetail(null);

    media
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((s) => {
        if (cancelled) {
          for (const track of s.getTracks()) track.stop();
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          // Best-effort , autoplay can reject on a cold element; the browser
          // still shows the first frame once decoded.
          void video.play().catch(() => {});
        }
        setStatus("live");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setStatus("denied");
          setDetail(DENIED_COPY);
        } else {
          setStatus("error");
          setDetail(ERROR_COPY);
        }
      });

    return () => {
      cancelled = true;
      if (stream) for (const track of stream.getTracks()) track.stop();
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { videoRef, status, detail, retry };
}
