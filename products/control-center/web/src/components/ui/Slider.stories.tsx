import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, within } from "storybook/test";
import { RangeSlider, Slider } from "./Slider";

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

export const Large: Story = {
  args: {
    label: "Lamp brightness",
    value: 72,
    min: 0,
    max: 100,
    size: "lg",
    format: (n) => `${n}%`,
  },
};

export const Scrub: Story = {
  args: {
    label: "Progress",
    value: 1250,
    min: 0,
    max: 3600,
    size: "scrub",
    showHeader: false,
  },
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole("slider", { name: "Progress" });
    await expect(slider).toHaveValue("1250");
  },
};

export const Stops: Story = {
  args: {
    label: "Party speed",
    value: 1,
    min: 0,
    max: 2,
    showHeader: false,
    stops: ["Slow", "Med", "Fast"],
  },
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole("slider", { name: "Party speed" });
    await expect(slider).toHaveValue("1");
  },
};

function VerticalControlled() {
  const [v, setV] = useState(66);
  return (
    <Slider
      label="Desk volume"
      value={v}
      min={0}
      max={100}
      onChange={setV}
      orientation="vertical"
      length={140}
    />
  );
}

export const Vertical: Story = {
  render: () => <VerticalControlled />,
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole("slider", { name: "Desk volume" });
    await expect(slider).toHaveValue("66");
    await expect(slider).toHaveAttribute("aria-orientation", "vertical");
  },
};

export const ChangeEnd: Story = {
  args: { label: "Dim level", value: 25, min: 1, max: 99, onChangeEnd: fn() },
};

function DualControlled() {
  const [band, setBand] = useState({ low: 68, high: 76 });
  return (
    <RangeSlider
      label="Heat-Cool band"
      low={band.low}
      high={band.high}
      min={65}
      max={80}
      minGap={2}
      onChange={setBand}
    />
  );
}

export const Dual: Story = {
  render: () => <DualControlled />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole("slider", { name: "Heat-Cool band low" })).toHaveValue("68");
    await expect(c.getByRole("slider", { name: "Heat-Cool band high" })).toHaveValue("76");
  },
};
