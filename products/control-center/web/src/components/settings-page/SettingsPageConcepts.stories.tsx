import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  SettingsConceptGroupedCards,
  SettingsConceptIconRail,
  SettingsConceptSplitDetail,
} from "./SettingsPageConcepts";

/**
 * Three full-page (1366x1024) Settings layout concepts to replace the current
 * modal. All controls are real shared primitives wired to local placeholder
 * state , click through the sidebar pages and flip the switches to feel each
 * layout. Pick one; the losers get deleted.
 */
const meta = {
  title: "Concepts/SettingsPage",
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

async function assertDisplayPage(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("slider", { name: "Brightness" })).toBeInTheDocument();
  await expect(canvas.getByRole("switch", { name: "Dim when idle" })).toBeInTheDocument();
}

/** iOS-Settings style: tinted icon-chip sidebar + inset grouped cards. */
export const AGroupedCards: Story = {
  name: "A , Grouped cards (iOS)",
  render: () => <SettingsConceptGroupedCards />,
  play: async ({ canvasElement }) => assertDisplayPage(canvasElement),
};

/** Narrow icon-only rail + one centered flat column (Linear/Vercel feel). */
export const BIconRail: Story = {
  name: "B , Icon rail (flat column)",
  render: () => <SettingsConceptIconRail />,
  play: async ({ canvasElement }) => assertDisplayPage(canvasElement),
};

/** Descriptive sidebar rows + two-column card grid per page. */
export const CSplitDetail: Story = {
  name: "C , Split detail (card grid)",
  render: () => <SettingsConceptSplitDetail />,
  play: async ({ canvasElement }) => assertDisplayPage(canvasElement),
};
