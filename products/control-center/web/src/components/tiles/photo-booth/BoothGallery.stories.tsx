/**
 * BoothGallery stories , the productionised photo-booth gallery at its true
 * 1366x1024 wall-panel size.
 *
 * Fixtures mirror the `boothPhotos.list` contract (groups newest-first, frames
 * by index) and a `photoUrl` that resolves each listing path to an inline SVG
 * data-URI, so the wall renders believably with no assets and no network , the
 * same split the real wiring uses (trpc data in, a URL builder in).
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { createElement } from "react";
import { fn } from "storybook/test";
import { BoothGallery, type BoothGroup } from "./BoothGallery";

const meta = {
  title: "Tiles/PhotoBooth/BoothGallery",
  component: BoothGallery,
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
    photoUrl: svgFor,
    onRemove: fn(),
    onBack: fn(),
  },
} satisfies Meta<typeof BoothGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: { groups: SAMPLE_GROUPS() },
};

export const Empty: Story = {
  args: { groups: [] },
};

// ---- fixtures --------------------------------------------------------------

const DAY_MS = 86_400_000;

/** A tiny gradient + emoji SVG, keyed by path so a frame always looks the same. */
function svgFor(path: string): string {
  const palettes = [
    ["#ff8a5c", "#ff3d81"],
    ["#22d3ee", "#3b82f6"],
    ["#f9d423", "#ff4e50"],
    ["#a8ff78", "#12c2b0"],
    ["#c471f5", "#fa71cd"],
    ["#ffd26f", "#ff8c42"],
  ];
  const emoji = ["😄", "🎉", "😎", "🐶", "🌟", "✌️", "🦄", "🔥", "💫", "🥳"];
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) >>> 0;
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

function frame(groupId: string, capturedAt: number, frameIdx: number, mimeType = "image/jpeg") {
  return {
    id: `bph_${groupId.slice(4)}_${frameIdx}`,
    path: `${groupId}/${frameIdx}.jpg`,
    capturedAt,
    frameIdx,
    mimeType,
  };
}

function group(
  n: number,
  mode: BoothGroup["mode"],
  capturedAt: number,
  frameCount: number,
): BoothGroup {
  const groupId = `bpg_${(1000 + n).toString(36)}`;
  const mimeType = mode === "gif" ? "image/gif" : "image/jpeg";
  const frames = Array.from({ length: frameCount }, (_, i) =>
    frame(groupId, capturedAt - i * 900, i, mimeType),
  );
  return { groupId, mode, capturedAt, frames };
}

/** A believable wall: mixed modes spread across the last several days. */
function SAMPLE_GROUPS(): BoothGroup[] {
  const now = Date.now();
  const specs: [BoothGroup["mode"], number, number, number][] = [
    // mode, dayOffset, minutesAgoIntoDay, frameCount
    ["photo", 0, 30, 1],
    ["four_frame", 0, 95, 4],
    ["burst", 0, 140, 3],
    ["gif", 0, 210, 1],
    ["photo", 0, 305, 1],
    ["photo", 1, 60, 1],
    ["four_frame", 1, 180, 4],
    ["burst", 1, 260, 3],
    ["photo", 1, 400, 1],
    ["gif", 2, 120, 1],
    ["photo", 2, 240, 1],
    ["photo", 4, 90, 1],
    ["four_frame", 4, 300, 4],
    ["burst", 6, 150, 3],
  ];
  return specs.map(([mode, dayOffset, minsAgo, frameCount], i) =>
    group(i, mode, now - dayOffset * DAY_MS - minsAgo * 60_000, frameCount),
  );
}
