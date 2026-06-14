import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { PlaceholderTile } from "./PlaceholderTile";

const meta = {
  title: "Components/PlaceholderTile",
  component: PlaceholderTile,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: 200, height: 160 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PlaceholderTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const tile = canvasElement.querySelector(".tile");
    expect(tile).toBeInTheDocument();
  },
};
