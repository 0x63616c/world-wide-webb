import type { Meta, StoryObj } from "@storybook/react-vite";
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
