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
  play: async ({ canvasElement }) => {
    // Query the .tile element directly — the global BoardDecorator wraps stories
    // in extra divs, so getByRole("generic") is now ambiguous (multiple matches).
    const tile = canvasElement.querySelector(".tile");
    expect(tile).not.toBeNull();
    // Proves tokens.css loaded: .tile { background: var(--tile) } must resolve to
    // the live --tile token. Resolve the token from :root and compare (don't
    // hardcode the hex, so a token change can't silently rot this assertion).
    const tileToken = getComputedStyle(document.documentElement).getPropertyValue("--tile").trim();
    const hex = tileToken.replace("#", "");
    const expected = `rgb(${Number.parseInt(hex.slice(0, 2), 16)}, ${Number.parseInt(hex.slice(2, 4), 16)}, ${Number.parseInt(hex.slice(4, 6), 16)})`;
    await expect(getComputedStyle(tile as HTMLElement).backgroundColor).toBe(expected);
  },
};
