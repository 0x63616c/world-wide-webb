import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { BoardVibeAuroraGlass, BoardVibeCreamPop, BoardVibePopBento } from "./BoardVibeConcepts";

/**
 * Round 2 board concepts , three NEW visual languages, deliberately breaking
 * from the current Vercel-black chrome: dark candy bento, aurora glass, and a
 * light cream sticker look. Mock tiles + local state only.
 */
const meta = {
  title: "Concepts/BoardVibes",
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Dark candy: tinted washes, chunky rounded type, sticker pills. */
export const APopBento: Story = {
  name: "A , Pop Bento (dark candy)",
  render: () => <BoardVibePopBento />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("14:32", {}, { timeout: 10000 })).toBeInTheDocument();
  },
};

/** Drifting gradient orbs behind frosted glass, neon ring setpoint. */
export const BAuroraGlass: Story = {
  name: "B , Aurora Glass",
  render: () => <BoardVibeAuroraGlass />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("14:32", {}, { timeout: 10000 })).toBeInTheDocument();
  },
};

/** Warm light panel, bold ink borders + offset shadows, sticker tags. */
export const CCreamPop: Story = {
  name: "C , Cream Pop (light sticker)",
  render: () => <BoardVibeCreamPop />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("14:32", {}, { timeout: 10000 })).toBeInTheDocument();
  },
};
