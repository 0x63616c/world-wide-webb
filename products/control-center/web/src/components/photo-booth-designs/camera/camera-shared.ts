/**
 * camera-shared , the design-agnostic model behind every Photo-booth camera
 * concept: the filter list, the capture modes, the countdown options, and the
 * two orchestration hooks (`useCapture`, `useReveal`) that every design drives.
 *
 * Keeping this here means the ten designs differ only in chrome and layout ,
 * they all share one definition of "what a filter is", "what a mode is", and
 * "what happens when you press the shutter", so a filter added here shows up
 * consistently across concepts.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ filters */

export interface CameraFilter {
  id: string;
  label: string;
  /** Value fed straight into CSS `filter` on the preview + captured frame. */
  css: string;
  /** Representative colour for swatch/pill chrome that wants a solid dot. */
  swatch: string;
}

/**
 * Live preview filters. All are pure CSS `filter` chains so they apply to the
 * <video> with zero per-frame work and read identically on the captured still.
 */
export const CAMERA_FILTERS: readonly CameraFilter[] = [
  { id: "none", label: "Original", css: "none", swatch: "#8a8f98" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.08)", swatch: "#d7d7d7" },
  {
    id: "sepia",
    label: "Sepia",
    css: "sepia(0.7) contrast(1.05) brightness(1.02)",
    swatch: "#b78a5a",
  },
  { id: "vivid", label: "Vivid", css: "saturate(1.75) contrast(1.12)", swatch: "#ff4d7d" },
  {
    id: "cool",
    label: "Cool",
    css: "hue-rotate(-16deg) saturate(1.2) brightness(1.04)",
    swatch: "#4db8ff",
  },
  {
    id: "warm",
    label: "Warm",
    css: "sepia(0.28) saturate(1.4) brightness(1.05) hue-rotate(-8deg)",
    swatch: "#ffab5e",
  },
  {
    id: "noir",
    label: "Noir",
    css: "grayscale(1) contrast(1.45) brightness(0.92)",
    swatch: "#4a4a4a",
  },
] as const;

export function filterCss(id: string): string {
  return CAMERA_FILTERS.find((f) => f.id === id)?.css ?? "none";
}

/* -------------------------------------------------------------------- modes */

export interface CameraMode {
  id: string;
  label: string;
  /** Short caption a design can surface under the active mode. */
  hint: string;
  /** Video is a visible placeholder , the wall panel captures stills only. */
  disabled?: boolean;
}

export const CAMERA_MODES: readonly CameraMode[] = [
  { id: "photo", label: "Photo", hint: "Single shot" },
  { id: "burst", label: "Burst", hint: "3 rapid frames" },
  { id: "grid", label: "4-Frame", hint: "4 shots, 3s apart" },
  { id: "gif", label: "GIF", hint: "Looping capture" },
  { id: "video", label: "Video", hint: "Coming soon", disabled: true },
] as const;

/* --------------------------------------------------------------- countdowns */

/** Seconds; 0 means the timer is off. */
export const COUNTDOWN_OPTIONS = [0, 1, 3, 5, 10] as const;
export type CountdownOption = (typeof COUNTDOWN_OPTIONS)[number];

export function countdownLabel(seconds: CountdownOption): string {
  return seconds === 0 ? "Off" : `${seconds}s`;
}

/* ------------------------------------------------------------ capture timing */

/** How long the white flash overlay stays lit at the capture moment. */
const FLASH_MS = 220;
/** How long the post-shutter "frozen" cue lasts (freeze/scale/ring animation). */
const CAPTURE_MS = 360;

export interface CaptureController {
  /** Live countdown value; null when no countdown is running. */
  count: number | null;
  /** True while a countdown is ticking (shutter should read as armed). */
  armed: boolean;
  /** True for the brief flash window , drives the full-screen white overlay. */
  flashing: boolean;
  /** True for the brief post-capture window , drives shutter/freeze animation. */
  capturing: boolean;
  /** Press the shutter: runs the countdown (if any) then captures. */
  shoot: () => void;
  /** Abort an in-progress countdown. */
  cancel: () => void;
}

export interface CaptureParams {
  /** Selected countdown, in seconds (0 = immediate). */
  countdown: CountdownOption;
  /** When true, the capture moment flashes the screen white. */
  flashOn: boolean;
  /** Optional hook for a design that wants to react to the capture instant. */
  onCapture?: () => void;
}

/**
 * The shared "press shutter → maybe count down → flash + freeze" state machine.
 * Every design reads `count`/`flashing`/`capturing` for its own animation and
 * calls `shoot()` from its shutter button; the timing and self-dedupe live here
 * so the ten concepts stay visually varied but behaviourally identical.
 */
export function useCapture(params: CaptureParams): CaptureController {
  const [count, setCount] = useState<number | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [capturing, setCapturing] = useState(false);

  // Latest params without re-arming timers mid-countdown.
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const fire = useCallback(() => {
    setCount(null);
    const { flashOn, onCapture } = paramsRef.current;
    onCapture?.();
    if (flashOn) {
      setFlashing(true);
      timers.current.push(setTimeout(() => setFlashing(false), FLASH_MS));
    }
    setCapturing(true);
    timers.current.push(setTimeout(() => setCapturing(false), CAPTURE_MS));
  }, []);

  const shoot = useCallback(() => {
    if (count !== null) return; // already counting down
    const seconds = paramsRef.current.countdown;
    if (seconds <= 0) {
      fire();
      return;
    }
    setCount(seconds);
    let remaining = seconds;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        fire();
        return;
      }
      setCount(remaining);
      timers.current.push(setTimeout(tick, 1000));
    };
    timers.current.push(setTimeout(tick, 1000));
  }, [count, fire]);

  const cancel = useCallback(() => {
    clearTimers();
    setCount(null);
  }, [clearTimers]);

  return { count, armed: count !== null, flashing, capturing, shoot, cancel };
}

/* --------------------------------------------------------- reveal-on-idle UI */

/**
 * A show/hide timer for concepts (Zen especially) that hide their chrome and
 * reveal it on interaction, then fade it back out after a beat. Returns the
 * current visibility plus a `poke()` to reveal-and-restart the fade.
 */
export function useReveal(
  timeoutMs = 3200,
  initial = true,
): {
  visible: boolean;
  poke: () => void;
} {
  const [visible, setVisible] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poke = useCallback(() => {
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), timeoutMs);
  }, [timeoutMs]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { visible, poke };
}
