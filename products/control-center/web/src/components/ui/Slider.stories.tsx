import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, within } from "storybook/test";
import { Slider } from "./Slider";

function Cell({ children }: { children: React.ReactNode }) {
  return <div style={{ width: 280, padding: 16 }}>{children}</div>;
}

const meta = {
  title: "UI/Slider",
  component: Slider,
  tags: ["autodocs"],
  args: {
    label: "Timeout",
    value: 10,
    min: 1,
    max: 60,
    step: 1,
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <Cell>
        <Story />
      </Cell>
    ),
  ],
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Minutes: Story = {
  args: { label: "Dim after", value: 10, min: 1, max: 60, format: (n) => `${n} min` },
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole("slider", { name: "Dim after" });
    await expect(slider).toHaveValue("10");
  },
};

export const Percent: Story = {
  args: { label: "Dim level", value: 25, min: 1, max: 99, format: (n) => `${n}%` },
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole("slider", { name: "Dim level" });
    await expect(slider).toHaveValue("25");
  },
};

// Live variant so the value readout tracks the drag.
function Controlled() {
  const [v, setV] = useState(25);
  return (
    <Slider label="Dim level" value={v} min={1} max={99} onChange={setV} format={(n) => `${n}%`} />
  );
}

export const Interactive: Story = {
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole("slider", { name: "Dim level" });
    await expect(slider).toHaveValue("25");
  },
};
