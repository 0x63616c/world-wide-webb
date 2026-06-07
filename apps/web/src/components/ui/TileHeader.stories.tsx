import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { TileHeader } from "./TileHeader";

const meta = {
  title: "UI/TileHeader",
  component: TileHeader,
  tags: ["autodocs"],
  args: {
    icon: "sun",
    title: "Weather",
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320, padding: 16, background: "var(--tile-1, #111)", borderRadius: 12 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TileHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default: icon + title only.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Weather")).toBeInTheDocument();
    const svg = canvasElement.querySelector("svg");
    await expect(svg).not.toBeNull();
  },
};

// WithRightSlot: a node is passed as `right`, aligned to the trailing edge.
export const WithRightSlot: Story = {
  args: {
    icon: "fan",
    title: "Climate",
    right: <span data-testid="right-slot">Auto</span>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Climate")).toBeInTheDocument();
    await expect(canvas.getByTestId("right-slot")).toBeInTheDocument();
    const svg = canvasElement.querySelector("svg");
    await expect(svg).not.toBeNull();
  },
};

// CustomSizes: non-default iconSize + titleSize.
export const CustomSizes: Story = {
  args: {
    icon: "bolt",
    title: "Power",
    iconSize: 24,
    titleSize: 20,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Power")).toBeInTheDocument();
    const svg = canvasElement.querySelector("svg");
    await expect(svg).not.toBeNull();
  },
};

// LongTitle: ensures the layout doesn't break with a very long title string.
export const LongTitle: Story = {
  args: {
    icon: "calendar",
    title: "Upcoming Events This Week",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Upcoming Events This Week")).toBeInTheDocument();
    const svg = canvasElement.querySelector("svg");
    await expect(svg).not.toBeNull();
  },
};
