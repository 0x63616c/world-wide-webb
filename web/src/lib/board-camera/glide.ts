/**
 * board-camera glide , the target math and the snap-mode-aware dispatch that
 * turns a world-space destination into a scroll move. Pure functions over a
 * scroll container + a Spring; the singleton (index.ts) supplies the live stage.
 *
 * Two move flavors, preserved verbatim from the old Board.tsx:
 *  - `glideTo`  (was glideToTile): spring mode drives it in JS, native modes use
 *    the browser's smooth scroll, and a scrollTo-less env falls back to instant.
 *  - `jumpTo`   (was jumpTo): native smooth/instant scroll regardless of snap
 *    mode , the minimap jump + idle glide-home path, which never uses the spring.
 */

import type { SnapMode } from "../settings";
import type { Spring } from "./camera";

/** Scroll offset (left/top) that centers world point (worldX, worldY) in the stage. */
export function centerOffset(
  stage: HTMLDivElement,
  worldX: number,
  worldY: number,
): { left: number; top: number } {
  return {
    left: worldX - stage.clientWidth / 2,
    top: worldY - stage.clientHeight / 2,
  };
}

/**
 * Glide the camera so world point (worldX, worldY) lands dead center. Spring
 * mode drives it in JS (same SmoothDamp feel as settle-snapping); native modes
 * use the browser's own smooth scroll, which then respects scroll-snap on
 * arrival. scrollTo is absent in some test/SSR envs , fall back to a direct
 * (instant) set.
 */
export function glideTo(
  stage: HTMLDivElement,
  snapMode: SnapMode,
  spring: Spring,
  worldX: number,
  worldY: number,
): void {
  const { left, top } = centerOffset(stage, worldX, worldY);
  if (snapMode === "spring") spring.to(stage, left, top);
  else if (typeof stage.scrollTo === "function") stage.scrollTo({ left, top, behavior: "smooth" });
  else {
    stage.scrollLeft = left;
    stage.scrollTop = top;
  }
}

/**
 * Center the viewport on world point (worldX, worldY) via the browser's native
 * scroll (smooth or instant). Unlike glideTo this never engages the JS spring ,
 * it is the minimap jump + idle glide-home path. scrollTo clamps to range.
 */
export function jumpTo(
  stage: HTMLDivElement,
  worldX: number,
  worldY: number,
  smooth: boolean,
): void {
  stage.scrollTo({
    left: worldX - stage.clientWidth / 2,
    top: worldY - stage.clientHeight / 2,
    behavior: smooth ? "smooth" : "auto",
  });
}
