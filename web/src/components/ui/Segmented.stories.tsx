import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { Segmented } from "./Segmented";

function Cell({ children }: { children: React.ReactNode }) {
  return <div style={{ width: 420, padding: 16 }}>{children}</div>;
}

const OPTIONS = [
  { value: "gentle", label: "gentle" },
  { value: "paged", label: "paged" },
  { value: "paged+", label: "paged+" },
  { value: "off", label: "off" },
  { value: "spring", label: "spring (old)" },
] as const;

const meta = {
  title: "UI/Segmented",
  component: Segmented,
  tags: ["autodocs"],
  args: {
    label: "Board snap",
    options: OPTIONS,
    value: "paged+",
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof Segmented<string>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selected = canvas.getByRole("radio", { name: "paged+" });
    await expect(selected).toHaveAttribute("aria-checked", "true");
    await expect(canvas.getByRole("radio", { name: "gentle" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  },
};

// Live variant so a click actually moves the selection.
function Controlled() {
  const [value, setValue] = useState<string>("paged+");
  return <Segmented label="Board snap" options={OPTIONS} value={value} onChange={setValue} />;
}

export const Interactive: Story = {
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: "gentle" }));
    await expect(canvas.getByRole("radio", { name: "gentle" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  },
};
