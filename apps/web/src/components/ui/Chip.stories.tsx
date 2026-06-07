import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Chip } from "./Chip";

function Cell({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "inline-flex", padding: 16 }}>{children}</div>;
}

const meta = {
  title: "UI/Chip",
  component: Chip,
  tags: ["autodocs"],
  args: {
    children: "Label",
    active: false,
    onClick: fn(),
  },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inactive: Story = {
  args: { active: false, children: "Inactive" },
  play: async ({ canvasElement }) => {
    const btn = within(canvasElement).getByRole("button", { name: "Inactive" });
    await expect(btn).toBeInTheDocument();
    // Has chip class, does NOT have on class.
    await expect(btn.classList.contains("chip")).toBe(true);
    await expect(btn.classList.contains("on")).toBe(false);
  },
};

export const Active: Story = {
  args: { active: true, children: "Active" },
  play: async ({ canvasElement }) => {
    const btn = within(canvasElement).getByRole("button", { name: "Active" });
    await expect(btn).toBeInTheDocument();
    // Has both chip and on classes.
    await expect(btn.classList.contains("chip")).toBe(true);
    await expect(btn.classList.contains("on")).toBe(true);
  },
};

export const Interactive: Story = {
  args: { active: false, children: "Click me", onClick: fn() },
  play: async ({ args, canvasElement }) => {
    const btn = within(canvasElement).getByRole("button", { name: "Click me" });
    await userEvent.click(btn);
    await expect(args.onClick).toHaveBeenCalled();
  },
};
