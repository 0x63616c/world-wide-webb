/**
 * Stories for TvRemoteModal (CC-51hf.17).
 *
 * Covers A21 acceptance: now-playing strip, D-pad, playback keys, no-mute note.
 * All state is prop-driven; no tRPC dependencies.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { TvRemoteModal } from "./TvRemoteModal";

const meta = {
  title: "Media/TvRemoteModal",
  component: TvRemoteModal,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      // Board is fixed 1366x1024 — render stories inside a dark 500-wide frame.
      <div style={{ width: 500, height: 700, background: "#111", position: "relative" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    open: true,
    onClose: fn(),
    state: "playing",
    appName: "Netflix",
    mediaTitle: "Stranger Things",
    mediaArtist: "Netflix Originals",
    artworkUrl: null,
    onPrev: fn(),
    onPlayPause: fn(),
    onNext: fn(),
    onUp: fn(),
    onDown: fn(),
    onLeft: fn(),
    onRight: fn(),
    onOk: fn(),
    onMenu: fn(),
    onHome: fn(),
    onPower: fn(),
  },
} satisfies Meta<typeof TvRemoteModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playing: Story = {
  args: { state: "playing" },
  play: async () => {
    const canvas = within(document.body);
    await expect(canvas.getByRole("dialog")).toBeTruthy();
    await expect(canvas.getByLabelText("Up")).toBeTruthy();
    await expect(canvas.getByLabelText("Down")).toBeTruthy();
    await expect(canvas.getByLabelText("Left")).toBeTruthy();
    await expect(canvas.getByLabelText("Right")).toBeTruthy();
    await expect(canvas.getByLabelText("OK")).toBeTruthy();
    await expect(canvas.getByLabelText(/menu/i)).toBeTruthy();
    await expect(canvas.getByLabelText("Home")).toBeTruthy();
    await expect(canvas.getByLabelText("Power")).toBeTruthy();
    await expect(canvas.getByLabelText("Pause")).toBeTruthy();
  },
};

export const Paused: Story = {
  args: { state: "paused" },
  play: async () => {
    const canvas = within(document.body);
    await expect(canvas.getByLabelText("Play")).toBeTruthy();
  },
};

export const WithArtwork: Story = {
  args: {
    artworkUrl: "https://picsum.photos/seed/tv/200/200",
    mediaTitle: "The Bear",
    mediaArtist: "FX Originals",
  },
};

export const NoMediaTitle: Story = {
  args: {
    mediaTitle: null,
    mediaArtist: null,
    appName: "YouTube",
  },
};

export const IdleStandby: Story = {
  args: {
    state: "idle",
    appName: null,
    mediaTitle: null,
    mediaArtist: null,
  },
};

export const NoMuteNote: Story = {
  name: "No-mute note present (A21)",
  play: async () => {
    const note = document.body.querySelector("[data-no-mute]");
    await expect(note).toBeTruthy();
  },
};
