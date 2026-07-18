/**
 * Wake-photo capture: when the panel is woken from its idle dim by a tap, grab
 * a short front-camera burst and upload each frame to the api. Entirely
 * best-effort , the wake interaction must never notice this exists, so every
 * failure path logs (into the frontend-logs pipeline, source "wake") and
 * gives up.
 *
 * Timing: getUserMedia cold-starts in ~0.5-1s on the panel, so a single
 * instant frame would mostly catch a black sensor. Three frames spread over
 * ~2s catch the tapper while they're still in front of the board.
 */

import { getDeviceId } from "./device-id";
import { log } from "./log/logger";

export const BURST_DELAYS_MS = [700, 1300, 2000] as const;

const JPEG_QUALITY = 0.8;

const wakeLog = log.child("wake");

let burstInFlight = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function grabFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  if (canvas.width === 0 || canvas.height === 0) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

async function uploadFrame(
  blob: Blob,
  sessionId: string | null,
  frameIdx: number,
): Promise<{ ok: boolean; status: number }> {
  const headers: Record<string, string> = {
    "Content-Type": "image/jpeg",
    "x-captured-at": String(Date.now()),
    "x-frame-idx": String(frameIdx),
    "x-device-id": getDeviceId(),
  };
  // Omitted rather than sent empty when there is no live session: an absent
  // header is unambiguously "unattributed", where "" would be a session id that
  // sorts and groups like a real one.
  if (sessionId) headers["x-session-id"] = sessionId;
  const res = await fetch("/media/wake-photo", { method: "POST", headers, body: blob });
  return { ok: res.ok, status: res.status };
}

/** Test seam: exercise the upload headers without a camera. */
export async function uploadBurstFramesForTests(
  sessionId: string | null,
  blobs: Blob[],
): Promise<void> {
  for (const [i, blob] of blobs.entries()) await uploadFrame(blob, sessionId, i);
}

async function runBurst(sessionId: string | null): Promise<void> {
  const startedAt = performance.now();
  wakeLog.info("burst start");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
  } catch (err) {
    // The single most diagnostic line: NotAllowedError here means the shell
    // build has no camera permission yet (Info.plist / TestFlight lag).
    wakeLog.warn("camera open failed", {
      name: err instanceof Error ? err.name : "unknown",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();

    let uploaded = 0;
    let elapsed = 0;
    for (const [frameIdx, at] of BURST_DELAYS_MS.entries()) {
      await sleep(at - elapsed);
      elapsed = at;
      const blob = await grabFrame(video);
      if (!blob) {
        wakeLog.warn("frame grab returned nothing", { at });
        continue;
      }
      const res = await uploadFrame(blob, sessionId, frameIdx);
      if (res.ok) uploaded += 1;
      else wakeLog.warn("frame upload rejected", { at, status: res.status, bytes: blob.size });
    }
    wakeLog.info("burst done", {
      uploaded,
      of: BURST_DELAYS_MS.length,
      ms: Math.round(performance.now() - startedAt),
    });
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

/**
 * Fire-and-forget burst. Self-deduping: a wake that lands while a burst is
 * already in flight is a no-op (double-taps on the dim overlay must not open
 * two camera streams). `runner` is injectable for tests only.
 */
export function captureWakeBurst(
  sessionId: string | null,
  runner: (sessionId: string | null) => Promise<void> = runBurst,
): void {
  if (burstInFlight) return;
  burstInFlight = true;
  runner(sessionId)
    .catch((err) =>
      wakeLog.warn("burst failed", {
        name: err instanceof Error ? err.name : "unknown",
        message: err instanceof Error ? err.message : String(err),
      }),
    )
    .finally(() => {
      burstInFlight = false;
    });
}
