import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ControlTap } from "./ControlTap";

// ControlTap fills its parent (width/height 100%), so each story sits in a
// fixed-size tile-shaped box matching its real footprint on the board/modal.
function Cell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 200, height: 120, borderRadius: 16, overflow: "hidden" }}>{children}</div>
  );
}

const meta = {
  title: "UI/ControlTap",
  component: ControlTap,
  tags: ["autodocs"],
  args: {
    icon: "lamp",
    label: "Lamps",
    on: true,
    onToggle: fn(),
  },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof ControlTap>;

export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {};

export const Off: Story = {
  args: { on: false },
};

// Swatch variant: a color circle replaces the icon (used for scene tiles).
export const Swatch: Story = {
  args: { icon: "bulb", label: "Blue", on: true, swatch: "rgb(0, 0, 255)" },
  play: async ({ canvasElement }) => {
    const swatch = within(canvasElement).getByLabelText("Blue").querySelector("[data-swatch]");
    await expect(swatch).not.toBeNull();
    await expect(canvasElement.querySelector("svg")).toBeNull();
  },
};

// Warm-white swatch: pale fill stays visible thanks to the inset ring.
export const SwatchWarmWhite: Story = {
  args: { icon: "bulb", label: "White", on: true, swatch: "rgb(255, 244, 224)" },
};

// Disabled: dimmed, non-interactive (e.g. Party tile when all lamps are off).
export const Disabled: Story = {
  args: { label: "Party", on: false, disabled: true },
  play: async ({ args, canvasElement }) => {
    const btn = within(canvasElement).getByLabelText("Party");
    await expect(btn).toBeDisabled();
    await userEvent.click(btn);
    await expect(args.onToggle).not.toHaveBeenCalled();
  },
};
