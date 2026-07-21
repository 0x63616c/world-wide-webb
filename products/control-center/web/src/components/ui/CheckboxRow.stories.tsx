import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { CheckboxRow } from "./CheckboxRow";

function Controlled({ initial, error }: { initial?: boolean; error?: boolean }) {
  const [checked, setChecked] = useState(!!initial);
  return (
    <CheckboxRow
      id="cb"
      checked={checked}
      error={error}
      errorMessage={error ? "Required" : undefined}
      onChange={setChecked}
    >
      I agree to the terms of use.
    </CheckboxRow>
  );
}

const meta = {
  title: "UI/CheckboxRow",
  component: CheckboxRow,
  tags: ["autodocs"],
  args: {
    id: "cb",
    checked: false,
    onChange: () => {},
    children: "I agree to the terms of use.",
  },
} satisfies Meta<typeof CheckboxRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole("checkbox");
    await expect(box).not.toBeChecked();
    await userEvent.click(box);
    await expect(box).toBeChecked();
  },
};

export const Checked: Story = {
  render: () => <Controlled initial />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("checkbox")).toBeChecked();
  },
};

export const ErrorState: Story = {
  name: "Error",
  render: () => <Controlled error />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Required")).toBeInTheDocument();
  },
};
