import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  ClimateHubConceptCanvasSplit,
  ClimateHubConceptFocusDeck,
  ClimateHubConceptZonesSidebar,
} from "./ClimateHubConcepts";

/**
 * Three full-page (1366x1024) Climate hub concepts in the settings-page design
 * language, wired to local placeholder state , switch zones, flip modes, drag
 * setpoints to feel each layout. Pick one; the losers get deleted.
 */
const meta = {
  title: "Experiments/Climate Hub",
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

async function assertZoneDetail(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(
    await canvas.findByRole("radiogroup", { name: "Living Room mode" }, { timeout: 10000 }),
  ).toBeInTheDocument();
}

/** SettingsPage twin: tinted zone sidebar + grouped cards column. */
export const AZonesSidebar: Story = {
  name: "A , Zones sidebar (settings twin)",
  render: () => <ClimateHubConceptZonesSidebar />,
  play: async ({ canvasElement }) => assertZoneDetail(canvasElement),
};

/** Viz-first: interactive zone canvas left, inspector column right. */
export const BCanvasSplit: Story = {
  name: "B , Canvas split (viz-first)",
  render: () => <ClimateHubConceptCanvasSplit />,
  play: async ({ canvasElement }) => assertZoneDetail(canvasElement),
};

/** Touch-first: zone rail, giant setpoint hero with steppers, schedule strip. */
export const CFocusDeck: Story = {
  name: "C , Focus deck (touch hero)",
  render: () => <ClimateHubConceptFocusDeck />,
  play: async ({ canvasElement }) => assertZoneDetail(canvasElement),
};
