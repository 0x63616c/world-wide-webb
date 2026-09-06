import type { Meta, StoryObj } from "@storybook/react-vite";
import { BentoHome } from "./BentoHome";
import { DevicePreview, TileFocusPreview, TileStudiesPreview } from "./BentoPreview";

const meta = {
  title: "Prototypes/Bento home",
  component: BentoHome,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen", boardWrapper: false },
} satisfies Meta<typeof BentoHome>;
export default meta;
type Story = StoryObj<typeof meta>;
export const White: Story = { name: "iPad layout", render: () => <DevicePreview /> };
export const Dark: Story = { name: "iPad layout · Dark", render: () => <DevicePreview dark /> };
export const TileStudies: Story = { name: "All tiles", render: () => <TileStudiesPreview /> };
export const PanelCanvas: Story = { name: "Panel at actual size" };

export const TileFocus: Story = { name: "Single tile", render: () => <TileFocusPreview /> };
