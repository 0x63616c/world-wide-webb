import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PageHeader } from "./PageHeader";

const meta = {
  title: "UI/PageHeader",
  component: PageHeader,
  tags: ["autodocs"],
  args: {
    title: "Photos",
    onBack: fn(),
  },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Title-only, as adopted by TileDetailHost (no right slot). */
export const TitleOnly: Story = {};

/** With a right slot , the gallery passes a photo count here. */
export const WithRightSlot: Story = {
  args: {
    right: <span style={{ fontSize: 16, color: "var(--ink-2)" }}>128 photos</span>,
  },
};
