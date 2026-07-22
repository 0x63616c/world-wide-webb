import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
import { TilePlaceholder } from "./TilePlaceholder";

const meta = {
  ...defineTileMeta("TilePlaceholder", TilePlaceholder),
} satisfies Meta<typeof TilePlaceholder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Climate: Story = {
  args: {
    label: "Climate",
    icon: "thermo",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Climate")).toBeInTheDocument();
    const svgs = canvasElement.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  },
};

export const Network: Story = {
  args: {
    label: "Network",
    icon: "wifi",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Network")).toBeInTheDocument();
    const svgs = canvasElement.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  },
};
