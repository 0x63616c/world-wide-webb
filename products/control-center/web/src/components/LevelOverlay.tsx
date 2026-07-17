/**
 * LevelOverlay , container for the full-screen level view. Owns the sensor
 * subscription (active only while open), the body portal (outside the pannable
 * #stage, same reasoning as Modal), and Escape-to-close for dev keyboards.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { registerOpenModal } from "../lib/modal-open-store";
import { useTiltAngle } from "../lib/useTiltAngle";
import { LevelOverlayView } from "./LevelOverlayView";

export interface LevelOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function LevelOverlay({ open, onClose }: LevelOverlayProps) {
  const reading = useTiltAngle(open);

  // Freeze board panning underneath, like every other overlay.
  useEffect(() => {
    if (!open) return;
    return registerOpenModal();
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

  return createPortal(<LevelOverlayView reading={reading} onClose={onClose} />, document.body);
}
