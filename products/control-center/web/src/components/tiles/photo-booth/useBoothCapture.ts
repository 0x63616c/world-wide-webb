/**
 * useBoothCapture , the real "press shutter → maybe count down → capture →
 * upload" state machine for the photo booth. Where the prototype's `useCapture`
 * only animated, this one actually bakes frames off the live <video> and uploads
 * them, so failures are real (a thrown upload surfaces as an on-screen error,
 * per the spec) rather than a swallowed log.
 *
 * Each mode drives a distinct sequence off one shutter press:
 *   - photo: one baked frame.
 *   - burst: 3 frames in fast succession, one shared group.
 *   - four_frame: 4 frames 3s apart (a short posing countdown between each), one
 *     shared group presented as a 2x2 grid in the gallery.
 *   - gif: ~12 frames grabbed rapidly, assembled into a boomerang GIF, uploaded
 *     as a single animation.
 *
 * The self-timer countdown and the between-shot posing countdown both drive the
 * same `count` overlay, with a tick sound per second and a shutter snap at each
 * capture. Multi-frame captures share a client-minted `bpg_<hex>` group id in
 * the exact shape the api validates; photo and gif are single-frame groups and
 * let the backend mint one.
 */

import { useEffect, useRef, useState } from "react";
import {
  assembleGif,
  type BoothMode,
  bakeFrame,
  uploadBoothPhoto,
} from "../../../lib/booth-capture";
import { playCountdownTick, playShutter } from "./booth-sounds";
import { type CountdownOption, filterCss } from "./camera-model";

// Sequence timing. Burst is a rapid stutter; four_frame is a paced posing
// interval; the GIF grabs a short window of frames for a smooth boomerang loop.
const BURST_COUNT = 3;
const BURST_INTERVAL_MS = 240;
const FOUR_FRAME_COUNT = 4;
const FOUR_FRAME_GAP_S = 3;
const GIF_FRAME_COUNT = 12;
const GIF_GRAB_INTERVAL_MS = 90;
const GIF_DELAY_MS = 80;
// How long the white flash overlay and the shutter "freeze" cue stay lit.
const FLASH_MS = 220;
const SHUTTER_FREEZE_MS = 300;
// How long a capture error lingers on screen before clearing itself.
const ERROR_LINGER_MS = 4000;

/** Mint a group id in the api's `^bpg_[0-9a-z]{1,32}$` shape (matches the backend). */
function newBoothGroupId(): string {
  const raw =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 14);
  return `bpg_${raw}`;
}

export interface BoothCaptureArgs {
  /** The live preview element frames are baked from. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  mode: BoothMode;
  /** Active filter id , baked into every saved frame. */
  filterId: string;
  /** Self-timer seconds (0 = immediate). */
  countdown: CountdownOption;
  /** Flash the screen white at each capture moment. */
  flashOn: boolean;
}

export interface BoothCaptureController {
  /** Live countdown value; null when no countdown is running. */
  count: number | null;
  /** True for the brief shutter "freeze" window , drives the shutter animation. */
  capturing: boolean;
  /** True for the brief flash window , drives the full-screen white overlay. */
  flashing: boolean;
  /** True for the whole capture sequence , disables controls / re-presses. */
  busy: boolean;
  /** A transient capture error to surface, cleared automatically. */
  error: string | null;
  /** Press the shutter: runs the timer (if any) then the mode's capture sequence. */
  shoot: () => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function useBoothCapture(args: BoothCaptureArgs): BoothCaptureController {
  const [count, setCount] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronous re-entry guard: a second press before React re-renders must not
  // start a second sequence, so a ref (not the async `busy` state) gates shoot.
  const runningRef = useRef(false);
  // Don't touch state after unmount , sequences span seconds of awaits.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Capture the args at press time so a sequence uses the mode/filter/flash the
  // user chose when they pressed, even if they change controls mid-sequence.
  const argsRef = useRef(args);
  argsRef.current = args;

  function fireShutterCue(): void {
    playShutter();
    if (argsRef.current.flashOn) {
      setFlashing(true);
      setTimeout(() => {
        if (aliveRef.current) setFlashing(false);
      }, FLASH_MS);
    }
    setCapturing(true);
    setTimeout(() => {
      if (aliveRef.current) setCapturing(false);
    }, SHUTTER_FREEZE_MS);
  }

  async function bakeCurrent(): Promise<Blob> {
    const video = argsRef.current.videoRef.current;
    if (!video) throw new Error("Camera not ready");
    return bakeFrame(video, {
      filterCss: filterCss(argsRef.current.filterId),
      mirror: true,
      stampDate: new Date(),
    });
  }

  /** Count down `seconds` → 0 with a tick per second, driving the big overlay. */
  async function runCountdown(seconds: number): Promise<void> {
    for (let n = seconds; n > 0; n--) {
      if (!aliveRef.current) return;
      setCount(n);
      playCountdownTick();
      await sleep(1000);
    }
    if (aliveRef.current) setCount(null);
  }

  async function capturePhoto(): Promise<void> {
    fireShutterCue();
    const blob = await bakeCurrent();
    await uploadBoothPhoto(blob, { mode: "photo", capturedAt: Date.now() });
  }

  async function captureBurst(): Promise<void> {
    const groupId = newBoothGroupId();
    for (let i = 0; i < BURST_COUNT; i++) {
      if (!aliveRef.current) return;
      fireShutterCue();
      const blob = await bakeCurrent();
      await uploadBoothPhoto(blob, {
        mode: "burst",
        groupId,
        capturedAt: Date.now(),
        frameIdx: i,
      });
      if (i < BURST_COUNT - 1) await sleep(BURST_INTERVAL_MS);
    }
  }

  async function captureFourFrame(): Promise<void> {
    const groupId = newBoothGroupId();
    for (let i = 0; i < FOUR_FRAME_COUNT; i++) {
      if (!aliveRef.current) return;
      // First shot fires straight off the shutter press; each later shot gets a
      // short posing countdown so the four are a paced 3s apart.
      if (i > 0) await runCountdown(FOUR_FRAME_GAP_S);
      if (!aliveRef.current) return;
      fireShutterCue();
      const blob = await bakeCurrent();
      await uploadBoothPhoto(blob, {
        mode: "four_frame",
        groupId,
        capturedAt: Date.now(),
        frameIdx: i,
      });
    }
  }

  async function captureGif(): Promise<void> {
    fireShutterCue();
    const frames: Blob[] = [];
    for (let i = 0; i < GIF_FRAME_COUNT; i++) {
      if (!aliveRef.current) return;
      frames.push(await bakeCurrent());
      if (i < GIF_FRAME_COUNT - 1) await sleep(GIF_GRAB_INTERVAL_MS);
    }
    const gif = await assembleGif(frames, { delayMs: GIF_DELAY_MS, boomerang: true });
    await uploadBoothPhoto(gif, { mode: "gif", capturedAt: Date.now() });
  }

  function runMode(mode: BoothMode): Promise<void> {
    switch (mode) {
      case "photo":
        return capturePhoto();
      case "burst":
        return captureBurst();
      case "four_frame":
        return captureFourFrame();
      case "gif":
        return captureGif();
    }
  }

  function shoot(): void {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    setError(null);

    void (async () => {
      try {
        const { countdown, mode } = argsRef.current;
        if (countdown > 0) await runCountdown(countdown);
        if (!aliveRef.current) return;
        await runMode(mode);
      } catch (err) {
        if (aliveRef.current) {
          setError(err instanceof Error ? err.message : "Capture failed");
          setTimeout(() => {
            if (aliveRef.current) setError(null);
          }, ERROR_LINGER_MS);
        }
      } finally {
        runningRef.current = false;
        if (aliveRef.current) {
          setBusy(false);
          setCount(null);
        }
      }
    })();
  }

  return { count, capturing, flashing, busy, error, shoot };
}
