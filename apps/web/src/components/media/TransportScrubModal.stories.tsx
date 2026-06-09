/**
 * Stories for TransportScrubModal (www-51hf.16).
 *
 * Covers A20 acceptance: streaming playing/paused, line-in, TV (no-seek note),
 * and artwork url. All state is prop-driven; no tRPC dependencies.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { TransportScrubModal } from "./TransportScrubModal";

const meta = {
  title: "Media/TransportScrubModal",
  component: TransportScrubModal,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      // Board is fixed 1366x1024 — render stories inside a dark 600-wide frame.
      <div style={{ width: 600, height: 700, background: "#111", position: "relative" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    open: true,
    onClose: fn(),
    onPrev: fn(),
    onPlayPause: fn(),
    onNext: fn(),
    onSeek: fn(),
  },
} satisfies Meta<typeof TransportScrubModal>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Streaming — playing ───────────────────────────────────────────────────────

export const StreamingPlaying: Story = {
  args: {
    state: "playing",
    appName: "Netflix",
    mediaTitle: "Stranger Things",
    mediaArtist: "Netflix Originals",
    mediaPosition: 1250,
    mediaDuration: 3600,
    source: "streaming",
    artworkUrl: null,
  },
  play: async ({ canvasElement }) => {
    const dialog = document.body.querySelector("[role='dialog']");
    await expect(dialog).toBeTruthy();
    const scrub = document.body.querySelector("[data-scrub]");
    await expect(scrub).toBeTruthy();
    const pauseBtn = document.body.querySelector("[aria-label='Pause']");
    await expect(pauseBtn).toBeTruthy();
  },
};

// ── Streaming — paused ────────────────────────────────────────────────────────

export const StreamingPaused: Story = {
  args: {
    state: "paused",
    appName: "Disney+",
    mediaTitle: "The Mandalorian",
    mediaArtist: null,
    mediaPosition: 600,
    mediaDuration: 2700,
    source: "streaming",
    artworkUrl: null,
  },
  play: async ({ canvasElement }) => {
    const playBtn = document.body.querySelector("[aria-label='Play']");
    await expect(playBtn).toBeTruthy();
  },
};

// ── Line-in: no-seek note ─────────────────────────────────────────────────────

export const LineIn: Story = {
  args: {
    state: "playing",
    appName: null,
    mediaTitle: null,
    mediaArtist: null,
    mediaPosition: null,
    mediaDuration: null,
    source: "line-in",
    artworkUrl: null,
  },
  play: async ({ canvasElement }) => {
    const noSeek = document.body.querySelector("[data-no-seek]");
    await expect(noSeek).toBeTruthy();
    const scrub = document.body.querySelector("[data-scrub]");
    await expect(scrub).toBeFalsy();
  },
};

// ── TV source: no-seek note ───────────────────────────────────────────────────

export const LiveTV: Story = {
  args: {
    state: "playing",
    appName: "TV",
    mediaTitle: "Live Sports",
    mediaArtist: null,
    mediaPosition: null,
    mediaDuration: null,
    source: "TV",
    artworkUrl: null,
  },
  play: async ({ canvasElement }) => {
    const noSeek = document.body.querySelector("[data-no-seek]");
    await expect(noSeek).toBeTruthy();
  },
};

// ── With artwork URL ──────────────────────────────────────────────────────────

export const WithArtwork: Story = {
  args: {
    state: "playing",
    appName: "Apple Music",
    mediaTitle: "Bohemian Rhapsody",
    mediaArtist: "Queen",
    mediaPosition: 90,
    mediaDuration: 354,
    source: "streaming",
    artworkUrl: "https://upload.wikimedia.org/wikipedia/en/4/4d/Queen_Greatest_Hits.png",
  },
  play: async ({ canvasElement }) => {
    const img = document.body.querySelector("img[alt*='artwork' i]");
    await expect(img).toBeTruthy();
  },
};

// ── Closed (renders nothing) ──────────────────────────────────────────────────

export const Closed: Story = {
  args: {
    open: false,
    state: "playing",
    appName: "Netflix",
    mediaTitle: "Stranger Things",
    mediaArtist: "Netflix Originals",
    mediaPosition: 60,
    mediaDuration: 3600,
    source: "streaming",
    artworkUrl: null,
  },
  play: async ({ canvasElement }) => {
    const dialog = document.body.querySelector("[role='dialog']");
    await expect(dialog).toBeFalsy();
  },
};
