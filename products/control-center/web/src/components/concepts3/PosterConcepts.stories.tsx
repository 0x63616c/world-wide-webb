import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { PosterAmbientScene, PosterSwissType, PosterTimelineRiver } from "./PosterConcepts";

const meta = {
  title: "Concepts/Round3/Poster",
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

export const AAmbientScene: Story = {
  name: "A , Ambient scene poster",
  render: () => <PosterAmbientScene />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("14:32", {}, { timeout: 10000 })).toBeInTheDocument();
  },
};

export const BSwissType: Story = {
  name: "B , Swiss type poster",
  render: () => <PosterSwissType />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("14:32", {}, { timeout: 10000 })).toBeInTheDocument();
  },
};

export const CTimelineRiver: Story = {
  name: "C , Timeline river poster",
  render: () => <PosterTimelineRiver />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("14:32", {}, { timeout: 10000 })).toBeInTheDocument();
  },
};
