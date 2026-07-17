/**
 * Wake-photo capture: when the panel is woken from its idle dim by a tap, grab
 * a short front-camera burst and upload each frame to the api. Entirely
 * best-effort , the wake interaction must never notice this exists, so every
 * failure path logs to the console and gives up.
 *
 * Timing: getUserMedia cold-starts in ~0.5-1s on the panel, so a single
 * instant frame would mostly catch a black sensor. Three frames spread over
 * ~2s catch the tapper while they're still in front of the board.
 */

export const BURST_DELAYS_MS = [700, 1300, 2000] as const;

const JPEG_QUALITY = 0.8;

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

async function uploadFrame(blob: Blob): Promise<void> {
  await fetch("/media/wake-photo", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg", "x-captured-at": String(Date.now()) },
    body: blob,
  });
}

async function runBurst(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: false,
  });
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();

    let elapsed = 0;
    for (const at of BURST_DELAYS_MS) {
      await sleep(at - elapsed);
      elapsed = at;
      const blob = await grabFrame(video);
      if (blob) await uploadFrame(blob);
    }
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

/**
 * Fire-and-forget burst. Self-deduping: a wake that lands while a burst is
 * already in flight is a no-op (double-taps on the dim overlay must not open
 * two camera streams). `runner` is injectable for tests only.
 */
export function captureWakeBurst(runner: () => Promise<void> = runBurst): void {
  if (burstInFlight) return;
  burstInFlight = true;
  runner()
    .catch((err) => console.warn("wake-photo burst failed", err))
    .finally(() => {
      burstInFlight = false;
    });
}
