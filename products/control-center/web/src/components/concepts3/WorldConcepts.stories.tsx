import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { WorldHouseBuddy, WorldIsoHouse } from "./WorldConcepts";

const meta = {
  title: "Concepts/Round3/World",
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

export const AIsoHouse: Story = {
  name: "A , Isometric house",
  render: () => <WorldIsoHouse />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("14:32", {}, { timeout: 10000 })).toBeInTheDocument();
  },
};

export const BHouseBuddy: Story = {
  name: "B , House buddy",
  render: () => <WorldHouseBuddy />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(/Cooling to 72°/, {}, { timeout: 10000 }),
    ).toBeInTheDocument();
  },
};
