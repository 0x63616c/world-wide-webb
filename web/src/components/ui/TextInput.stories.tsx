import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { TextInput } from "./TextInput";

function Cell({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "block", width: 320, padding: 16 }}>{children}</div>;
}

const meta = {
  title: "UI/TextInput",
  component: TextInput,
  tags: ["autodocs"],
  args: {
    label: "Device name",
    value: "",
    placeholder: "iPad",
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { value: "" },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Device name" });
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute("placeholder", "iPad");
  },
};

export const Filled: Story = {
  args: { value: "Calum's Laptop" },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Device name" });
    await expect(input).toHaveValue("Calum's Laptop");
  },
};

export const Disabled: Story = {
  args: { value: "iPad", disabled: true },
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Device name" });
    await userEvent.type(input, "x");
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

// Live-typing variant so the story exercises the real onChange path.
function Controlled() {
  const [value, setValue] = useState("");
  return <TextInput label="Device name" value={value} onChange={setValue} placeholder="iPad" />;
}

export const Interactive: Story = {
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Device name" });
    await userEvent.type(input, "iPhone");
    await expect(input).toHaveValue("iPhone");
  },
};
