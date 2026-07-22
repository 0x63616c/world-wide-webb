import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { Switch } from "./Switch";

function Cell({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "inline-flex", padding: 16 }}>{children}</div>;
}

const meta = {
  title: "UI/Switch",
  component: Switch,
  tags: ["autodocs"],
  args: {
    label: "Toggle setting",
    checked: false,
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {
  args: { checked: false },
  play: async ({ canvasElement }) => {
    const sw = within(canvasElement).getByRole("switch", { name: "Toggle setting" });
    await expect(sw).toHaveAttribute("aria-checked", "false");
  },
};

export const On: Story = {
  args: { checked: true },
  play: async ({ canvasElement }) => {
    const sw = within(canvasElement).getByRole("switch", { name: "Toggle setting" });
    await expect(sw).toHaveAttribute("aria-checked", "true");
  },
};

export const Disabled: Story = {
  args: { checked: false, disabled: true },
  play: async ({ args, canvasElement }) => {
    const sw = within(canvasElement).getByRole("switch", { name: "Toggle setting" });
    await userEvent.click(sw);
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

// Live-toggling variant so the story exercises the real interaction path.
function Controlled() {
  const [on, setOn] = useState(false);
  return <Switch label="Idle dim" checked={on} onChange={setOn} />;
}

export const Interactive: Story = {
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const sw = within(canvasElement).getByRole("switch", { name: "Idle dim" });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);
    await expect(sw).toHaveAttribute("aria-checked", "true");
  },
};
