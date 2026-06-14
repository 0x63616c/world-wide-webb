/**
 * Stories for TvNowPlayingTileView (www-51hf.15).
 *
 * Covers the source-aware states required by A19: streaming playing/paused,
 * line-in, TV (live TV), idle/standby, and loading skeleton.
 *
 * TvNowPlayingTileViewProps is a discriminated union; a thin wrapper with a
 * flat props signature lets Storybook infer args correctly.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { TvNowPlayingTileView, type TvSource } from "./TvNowPlayingTileView";

// ── Flat props wrapper (avoids discriminated-union arg inference issues) ───────

type WrapperProps = {
  status: "loading" | "error" | "populated";
  state?: string;
  appName?: string | null;
  mediaTitle?: string | null;
  mediaArtist?: string | null;
  mediaPosition?: number | null;
  mediaDuration?: number | null;
  source?: TvSource;
  artworkUrl?: string | null;
};

function TvNowPlayingTileViewStory({
  status,
  state,
  appName,
  mediaTitle,
  mediaArtist,
  mediaPosition,
  mediaDuration,
  source,
  artworkUrl,
}: WrapperProps) {
  if (status !== "populated") {
    return <TvNowPlayingTileView status={status} />;
  }
  return (
    <TvNowPlayingTileView
      status="populated"
      state={state ?? "idle"}
      appName={appName ?? null}
      mediaTitle={mediaTitle ?? null}
      mediaArtist={mediaArtist ?? null}
      mediaPosition={mediaPosition ?? null}
      mediaDuration={mediaDuration ?? null}
      source={source ?? "idle"}
      artworkUrl={artworkUrl ?? null}
    />
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "Media/TvNowPlayingTileView",
  component: TvNowPlayingTileViewStory,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: 400, height: 500 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TvNowPlayingTileViewStory>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

// Loading shimmer (A18)
export const Loading: Story = {
  args: { status: "loading" },
  play: async ({ canvasElement }) => {
    const tile = canvasElement.querySelector(".tile");
    await expect(tile).toBeTruthy();
    const skeletons = canvasElement.querySelectorAll("[data-skeleton]");
    await expect(skeletons.length).toBeGreaterThan(0);
  },
};

// Error state also renders skeleton
export const ErrorState: Story = {
  args: { status: "error" },
  play: async ({ canvasElement }) => {
    const skeletons = canvasElement.querySelectorAll("[data-skeleton]");
    await expect(skeletons.length).toBeGreaterThan(0);
  },
};

// Streaming , playing
export const StreamingPlaying: Story = {
  args: {
    status: "populated",
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
    const pauseBtn = canvasElement.querySelector("[aria-label='Pause']");
    await expect(pauseBtn).toBeTruthy();
  },
};

// Streaming , paused
export const StreamingPaused: Story = {
  args: {
    status: "populated",
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
    const playBtn = canvasElement.querySelector("[aria-label='Play']");
    await expect(playBtn).toBeTruthy();
  },
};

// Line-in source
export const LineIn: Story = {
  args: {
    status: "populated",
    state: "playing",
    appName: null,
    mediaTitle: null,
    mediaArtist: null,
    mediaPosition: null,
    mediaDuration: null,
    source: "line-in",
    artworkUrl: null,
  },
};

// Live TV source
export const LiveTV: Story = {
  args: {
    status: "populated",
    state: "playing",
    appName: "TV",
    mediaTitle: "Live Sports",
    mediaArtist: null,
    mediaPosition: null,
    mediaDuration: null,
    source: "TV",
    artworkUrl: null,
  },
};

// Idle / standby
export const Idle: Story = {
  args: {
    status: "populated",
    state: "idle",
    appName: null,
    mediaTitle: null,
    mediaArtist: null,
    mediaPosition: null,
    mediaDuration: null,
    source: "idle",
    artworkUrl: null,
  },
};
