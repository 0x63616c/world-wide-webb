import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Tile } from "./Tile";
import { TileHeader } from "./TileHeader";

const meta = {
  title: "UI/Tile",
  component: Tile,
  tags: ["autodocs"],
  args: {
    padding: 20,
    children: <TileHeader icon="wifi" title="Tile preview" />,
  },
} satisfies Meta<typeof Tile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomPadding: Story = {
  args: { padding: 28 },
};

// Proves that tokens.css loaded — tile background must resolve to the --tile token value.
export const CssCheck: Story = {
  play: async ({ canvas }) => {
    const tile = canvas.getByRole("generic", { hidden: true });
    // .tile { background: var(--tile) } resolves to #0c0e11 = rgb(12, 14, 17)
    await expect(getComputedStyle(tile).backgroundColor).toBe("rgb(12, 14, 17)");
  },
};
