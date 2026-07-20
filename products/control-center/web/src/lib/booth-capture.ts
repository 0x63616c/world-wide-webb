/**
 * Booth-photo capture pipeline: the client half of the photo-booth feature.
 * Where wake-capture is a silent best-effort burst on undim, these are
 * deliberate captures a person triggers, so failures here are real errors the
 * camera UI reacts to (a thrown upload, not a swallowed log).
 *
 * Three stages, each independently testable:
 *   - bakeFrame: draw the live video frame to a canvas, applying the selected
 *     CSS filter, the mirror correction (the preview is mirrored so it reads
 *     like a mirror; the saved image un-mirrors so text/scenes are correct),
 *     and a bottom-right date stamp. Returns a JPEG blob.
 *   - assembleGif: stitch several baked frames into an animated GIF via gifenc,
 *     optionally as a forward-then-back boomerang loop.
 *   - uploadBoothPhoto: POST the bytes to the api, mirroring wake-capture's
 *     upload mechanics (raw body + attribution headers), returning the new id.
 *
 * The drawing and frame-ordering logic are split out (drawBoothFrame,
 * orderGifFrames, formatStampDate) so they unit-test without a real canvas,
 * which jsdom does not provide.
 */

import { applyPalette, GIFEncoder, quantize } from "gifenc";

import { getDeviceId } from "./device-id";

// Kept in lockstep with the api's booth_photo.mode column
// (photo | burst | four_frame | gif). "video" is a disabled placeholder in the
// UI and never reaches capture, so it is deliberately absent here.
export type BoothMode = "photo" | "burst" | "four_frame" | "gif";

const JPEG_QUALITY = 0.9;

// The booth upload route mirrors /media/wake-photo. Confirmed against the api's
// wake stack + booth schema; see the note in the task return if the backend
// lands a different path.
const UPLOAD_URL = "/media/booth-photo";

export interface BakeOptions {
  /** A CSS `filter` string (e.g. "sepia(0.6) contrast(1.1)"); "none" for raw. */
  filterCss: string;
  /** Un-mirror the mirrored preview so the saved frame reads correctly. */
  mirror: boolean;
  /** Wall-clock time to stamp into the bottom-right corner. */
  stampDate: Date;
}

export interface BoothUploadMeta {
  mode: BoothMode;
  /**
   * Ties the frames of one capture together (bpg_<id>). A burst / 4-frame
   * shares it across frames; a single photo or gif is a group of one. Omit only
   * when the backend should mint one.
   */
  groupId?: string;
  /** ms since epoch when the frame was captured. */
  capturedAt: number;
  /** 0-based position within the group; defaults to 0. */
  frameIdx?: number;
  /**
   * Non-destructive filter id to store on the row (`^[a-z0-9_]{1,32}$`). The
   * saved bytes are the RAW frame; the gallery applies this id as a CSS filter
   * at display time. Omit for an unfiltered capture and for a gif (whose filter
   * is baked into its assembled frames, so it stores none).
   */
  filter?: string;
}

/**
 * Two-space-padded YYYY.MM.DD HH:MM in local time. Built from date parts (not
 * toLocaleString) so the stamp format is stable across locales and test envs.
 */
export function formatStampDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const ymd = `${date.getFullYear()}.${p(date.getMonth() + 1)}.${p(date.getDate())}`;
  return `${ymd} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

// Draw the translucent monospace date stamp bottom-right, unfiltered and
// un-mirrored (a drop shadow behind so it survives both light and dark frames).
function drawDateStamp(
  ctx: CanvasRenderingContext2D,
  date: Date,
  width: number,
  height: number,
): void {
  const pad = Math.max(10, Math.round(height * 0.025));
  const size = Math.max(12, Math.round(height * 0.03));
  const label = formatStampDate(date);
  ctx.save();
  ctx.filter = "none";
  ctx.font = `${size}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillText(label, width - pad + 1, height - pad + 1);
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillText(label, width - pad, height - pad);
  ctx.restore();
}

/**
 * Render one baked frame into a 2d context: filter + optional horizontal mirror
 * for the video draw, then a stamp. Pure w.r.t. the context so it is testable
 * with a recording stand-in; bakeFrame wires it to a real canvas.
 */
export function drawBoothFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  { filterCss, mirror, stampDate }: BakeOptions,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.filter = filterCss || "none";
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, width, height);
  ctx.restore();
  drawDateStamp(ctx, stampDate, width, height);
}

/**
 * Draw the current video frame to an offscreen canvas at native resolution,
 * apply the filter + mirror + date stamp, and return a JPEG blob (quality 0.9).
 */
export async function bakeFrame(video: HTMLVideoElement, opts: BakeOptions): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width === 0 || height === 0) throw new Error("booth bake: video has no frame yet");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("booth bake: no 2d context");

  drawBoothFrame(ctx, video, opts, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("booth bake: canvas produced no blob");
  return blob;
}

/**
 * Order frames for a GIF. A boomerang plays forward then back, so we append the
 * interior frames reversed (endpoints excluded to avoid a double beat). Too
 * short to boomerang (<3) or boomerang off returns a plain copy.
 */
export function orderGifFrames<T>(frames: T[], boomerang: boolean): T[] {
  if (!boomerang || frames.length < 3) return [...frames];
  return [...frames, ...frames.slice(1, -1).reverse()];
}

// Decode an image blob to raw RGBA. Browser-only (createImageBitmap + a canvas
// readback); jsdom has neither, so assembleGif is exercised in the real webview
// and Storybook, not unit tests.
async function decodeToRgba(
  blob: Blob,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("booth gif: no 2d context");
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { data, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

export interface GifOptions {
  /** Per-frame delay in milliseconds. */
  delayMs: number;
  /** Play forward then back for a seamless loop. */
  boomerang: boolean;
}

/**
 * Assemble baked JPEG frames into an animated GIF with gifenc: quantize each
 * frame to a 256-colour palette, map it to an indexed bitmap, and stream it out.
 * All frames are assumed to share the first frame's dimensions (they come from
 * one camera stream).
 */
export async function assembleGif(frames: Blob[], opts: GifOptions): Promise<Blob> {
  if (frames.length === 0) throw new Error("booth gif: no frames to assemble");
  const ordered = orderGifFrames(frames, opts.boomerang);
  const decoded = await Promise.all(ordered.map(decodeToRgba));
  const { width, height } = decoded[0];

  const gif = GIFEncoder();
  for (const { data } of decoded) {
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, { palette, delay: opts.delayMs });
  }
  gif.finish();
  // gifenc types bytes() as a plain Uint8Array; copy into a fresh ArrayBuffer-
  // backed view so it satisfies BlobPart under the current lib.dom typings.
  const bytes = new Uint8Array(gif.bytes());
  return new Blob([bytes], { type: "image/gif" });
}

/**
 * Flatten a display-time CSS filter into an already-final frame's pixels for
 * share/export. The gallery stores RAW frames and applies filters at display
 * time, so a filtered capture that leaves the app (a native share) must carry
 * the effect in its bytes. Unlike bakeFrame this neither mirrors nor stamps ,
 * the stored frame already carries both , it only draws the source under the
 * given filter. Browser-only (createImageBitmap + a canvas), like assembleGif.
 */
export async function bakeFilterIntoImage(imageUrl: string, filterCss: string): Promise<Blob> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`booth share bake: fetch ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("booth share bake: no 2d context");
    ctx.filter = filterCss || "none";
    ctx.drawImage(bitmap, 0, 0);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!out) throw new Error("booth share bake: canvas produced no blob");
    return out;
  } finally {
    bitmap.close();
  }
}

/**
 * Upload one baked frame to the api, mirroring wake-capture's raw-body +
 * attribution-header mechanics. Returns the new photo id. Unlike the wake
 * burst this throws on failure , the camera UI owns the user-facing reaction.
 */
export async function uploadBoothPhoto(blob: Blob, meta: BoothUploadMeta): Promise<{ id: string }> {
  const headers: Record<string, string> = {
    "Content-Type": meta.mode === "gif" ? "image/gif" : "image/jpeg",
    "x-captured-at": String(meta.capturedAt),
    "x-mode": meta.mode,
    "x-frame-idx": String(meta.frameIdx ?? 0),
    "x-device-id": getDeviceId(),
  };
  // Omitted rather than sent empty when the capture has no group: an absent
  // header is unambiguously "let the backend group it", where "" would be a
  // group id that sorts like a real one.
  if (meta.groupId) headers["x-group-id"] = meta.groupId;
  // Non-destructive filter: sent only for a filtered still capture. An absent
  // header stores null (unfiltered), which is also what a gif sends , its filter
  // is already baked into the assembled frames.
  if (meta.filter) headers["x-filter"] = meta.filter;

  const res = await fetch(UPLOAD_URL, { method: "POST", headers, body: blob });
  if (!res.ok) throw new Error(`booth upload failed: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return { id: body.id };
}
