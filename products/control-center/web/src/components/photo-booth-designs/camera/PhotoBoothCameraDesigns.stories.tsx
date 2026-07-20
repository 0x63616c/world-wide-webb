/**
 * Ten design prototypes for a fullscreen "Photo booth" camera screen on the
 * fixed 1366×1024 wall panel. Each story renders one concept at exact panel
 * size against a live front-camera preview (useCameraPreview); where Storybook
 * has no camera/permission the shared CameraStage paints a styled fallback so
 * every story still renders in CI.
 *
 * These are throwaway exploration surfaces , the user picks one. They live in
 * their own folder and touch no production tiles.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentType } from "react";
import { CameraDesign01 } from "./CameraDesign01";
import { CameraDesign02 } from "./CameraDesign02";
import { CameraDesign03 } from "./CameraDesign03";
import { CameraDesign04 } from "./CameraDesign04";
import { CameraDesign05 } from "./CameraDesign05";
import { CameraDesign06 } from "./CameraDesign06";
import { CameraDesign07 } from "./CameraDesign07";
import { CameraDesign08 } from "./CameraDesign08";
import { CameraDesign09 } from "./CameraDesign09";
import { CameraDesign10 } from "./CameraDesign10";

/** Fixed wall-panel stage , every concept is pinned to exactly 1366×1024. */
function Stage({ Design }: { Design: ComponentType }) {
  return (
    <div style={{ width: 1366, height: 1024, position: "relative", overflow: "hidden" }}>
      <Design />
    </div>
  );
}

const meta: Meta<typeof Stage> = {
  title: "PhotoBoothDesigns/Camera",
  tags: ["autodocs"],
  component: Stage,
  parameters: {
    layout: "fullscreen",
    // Opt out of the board-sizing decorator , these fill the panel themselves.
    boardWrapper: false,
  },
};

export default meta;

type Story = StoryObj<typeof Stage>;

export const ApertureMinimal: Story = {
  name: "01 Aperture (iOS minimal)",
  render: () => <Stage Design={CameraDesign01} />,
};

export const ArcadeBooth: Story = {
  name: "02 Arcade Booth (retro)",
  render: () => <Stage Design={CameraDesign02} />,
};

export const Instant: Story = {
  name: "03 Instant (polaroid)",
  render: () => <Stage Design={CameraDesign03} />,
};

export const Brutal: Story = {
  name: "04 Brutal (brutalist mono)",
  render: () => <Stage Design={CameraDesign04} />,
};

export const AuroraGlass: Story = {
  name: "05 Aurora Glass (glassmorphism)",
  render: () => <Stage Design={CameraDesign05} />,
};

export const Reel: Story = {
  name: "06 Reel (filmstrip rail)",
  render: () => <Stage Design={CameraDesign06} />,
};

export const Dial: Story = {
  name: "07 Dial (radial rotary)",
  render: () => <Stage Design={CameraDesign07} />,
};

export const Confetti: Story = {
  name: "08 Confetti (party mode)",
  render: () => <Stage Design={CameraDesign08} />,
};

export const ProHud: Story = {
  name: "09 Pro HUD (viewfinder)",
  render: () => <Stage Design={CameraDesign09} />,
};

export const Zen: Story = {
  name: "10 Zen (edge-to-edge)",
  render: () => <Stage Design={CameraDesign10} />,
};
