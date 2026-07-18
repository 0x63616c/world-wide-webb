/**
 * LevelOverlay , container for the full-screen level view. Owns the sensor
 * subscription (active only while open), the body portal (outside the pannable
 * #stage, same reasoning as Modal), and Escape-to-close for dev keyboards.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { registerOpenModal } from "../lib/modal-open-store";
import { useTiltAngle } from "../lib/useTiltAngle";
import { type LevelAxis, LevelOverlayView } from "./LevelOverlayView";

export interface LevelOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function LevelOverlay({ open, onClose }: LevelOverlayProps) {
  const reading = useTiltAngle(open);

  // Which tilt is on screen. Deliberately NOT persisted: every open starts on
  // left/right (the mount error you normally chase), and forward/back is a
  // choice you make for the one viewing, via the button in the view.
  const [axis, setAxis] = useState<LevelAxis>("roll");
  const swapAxis = useCallback(() => setAxis((a) => (a === "roll" ? "pitch" : "roll")), []);
  useEffect(() => {
    if (!open) setAxis("roll");
  }, [open]);

  // Freeze board panning underneath, like every other overlay, and hand over a
  // dismisser so the board's idle reset can close this on its way home (ref'd so
  // a fresh onClose closure never re-registers).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    return registerOpenModal(() => onCloseRef.current());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <LevelOverlayView reading={reading} axis={axis} onSwapAxis={swapAxis} onClose={onClose} />,
    document.body,
  );
}
