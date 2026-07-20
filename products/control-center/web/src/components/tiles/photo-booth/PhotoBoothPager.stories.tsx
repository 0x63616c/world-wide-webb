/**
 * PhotoBoothPager stories , the fullscreen camera ⇄ gallery flow the detail host
 * mounts for the photo-booth tile, at its true 1366x1024 wall size.
 *
 * The pager is presentational (the real `photo-booth` wiring feeds it live
 * `boothPhotos.list` data), so these fixtures mirror that contract , a couple of
 * capture groups plus a `photoUrl` that resolves each path to an inline SVG , and
 * the TapThrough story drives the whole camera → gallery → camera path with no
 * backend. There is no camera in CI, so the camera stage paints its fallback.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { createElement } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import type { BoothGroup } from "./BoothGallery";
import { PhotoBoothPager } from "./PhotoBoothPager";

const meta = {
  title: "Tiles/PhotoBooth/PhotoBoothPager",
  component: PhotoBoothPager,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    // This page owns the full 1366x1024 frame , bypass the tile board decorator.
    boardWrapper: false,
  },
  decorators: [
    (Story) =>
      createElement(
        "div",
        {
          className: "e-root",
          style: {
            width: 1366,
            height: 1024,
            overflow: "hidden",
            position: "relative",
            background: "var(--bg)",
            display: "flex",
            flexDirection: "column",
          },
        },
        createElement(Story),
      ),
  ],
  args: {
    groups: SAMPLE_GROUPS(),
    photoUrl: svgFor,
    onRemove: fn(),
    onClearFilter: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof PhotoBoothPager>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Landing view , the full-bleed camera (fallback preview in CI). */
export const Camera: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Shutter" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Open gallery" })).toBeInTheDocument();
  },
};

/** Camera → gallery (bottom-left button) → back to camera (header back). */
export const TapThrough: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Camera first.
    await userEvent.click(await canvas.findByRole("button", { name: "Open gallery" }));
    // Gallery mounted , its sticky "Photos" header is showing.
    await expect(await canvas.findByRole("heading", { name: "Photos" })).toBeInTheDocument();
    // Back returns to the camera.
    await userEvent.click(canvas.getByRole("button", { name: "Back to board" }));
    await expect(await canvas.findByRole("button", { name: "Shutter" })).toBeInTheDocument();
  },
};

// ---- fixtures --------------------------------------------------------------

/** A tiny gradient + emoji SVG, keyed by path so a frame always looks the same. */
function svgFor(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) >>> 0;
  const palettes = [
    ["#ff8a5c", "#ff3d81"],
    ["#22d3ee", "#3b82f6"],
    ["#a8ff78", "#12c2b0"],
    ["#c471f5", "#fa71cd"],
  ];
  const emoji = ["😄", "🎉", "😎", "🐶", "🌟", "🥳"];
  const [a, b] = palettes[h % palettes.length];
  const e = emoji[(h >> 3) % emoji.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">` +
    `<defs><linearGradient id="g" gradientTransform="rotate(${h % 360} .5 .5)">` +
    `<stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="400" height="400" fill="url(#g)"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="180">${e}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function group(
  n: number,
  mode: BoothGroup["mode"],
  capturedAt: number,
  frameCount: number,
): BoothGroup {
  const groupId = `bpg_${(1000 + n).toString(36)}`;
  const mimeType = mode === "gif" ? "image/gif" : "image/jpeg";
  const frames = Array.from({ length: frameCount }, (_, i) => ({
    id: `bph_${groupId.slice(4)}_${i}`,
    path: `${groupId}/${i}.jpg`,
    capturedAt: capturedAt - i * 900,
    frameIdx: i,
    mimeType,
    filter: null,
  }));
  return { groupId, mode, capturedAt, filter: null, frames };
}

/** A small believable roll spanning today , enough to render a dated grid. */
function SAMPLE_GROUPS(): BoothGroup[] {
  const now = Date.now();
  return [
    group(0, "photo", now - 30 * 60_000, 1),
    group(1, "four_frame", now - 95 * 60_000, 4),
    group(2, "burst", now - 140 * 60_000, 3),
    group(3, "gif", now - 210 * 60_000, 1),
  ];
}
